/**
 * Voice-call state for "call my agent" on /my-agent.
 *
 * The call reuses the SAME agent the page chats with: the user's speech is
 * transcribed in-browser (Web Speech API) and dispatched through the gateway
 * `chat.send` path (see `sendVoiceTurn` in gateway.svelte) so the agent's
 * prompt engineering, tools and context are identical to text chat — there is
 * no separate voice LLM. The agent's reply (streamed back into the same chat
 * thread) is spoken aloud via keyless Edge TTS (/api/voice/tts) and the
 * OpenHuman avatar lip-syncs from the returned audio (wawa-lipsync).
 *
 * Because both the user's transcript and the agent's reply flow through the
 * personal-agent chat, the entire call is transcribed in the chat section for
 * free.
 *
 * STT + lip-sync logic ported from the meeting-agent demo's useVoiceLoop.ts.
 */
import { Lipsync } from 'wawa-lipsync';
import { REST_MOUTH, visemeToMouth, type AgentVoiceState, type MouthShape } from '$lib/voice/visemeMap';
import { agentChat, onAgentReplyFinal } from '$lib/state/chat/chat.svelte';
import { sendVoiceTurn } from '$lib/services/gateway.svelte';
import { extractText } from '$lib/utils/text';

// --- Minimal Web Speech API typings (not in TS DOM lib) ---------------------
interface SpeechRecognitionResult {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResult };
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognition;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Reactive surface consumed by the page + controls.
const ui = $state({
  active: false,
  status: 'idle' as AgentVoiceState,
  muted: false,
  error: null as string | null,
  interim: '',
  agentId: null as string | null,
});

/**
 * Shared mouth shape — mutated each animation frame while speaking and read by
 * the avatar's own rAF loop. Plain object (not $state) on purpose: it changes
 * 60×/s and the avatar reads it imperatively.
 */
export const mouth: MouthShape = { ...REST_MOUTH };

// Non-reactive call internals.
let recog: SpeechRecognition | null = null;
let lipsync: Lipsync | null = null;
let activeFlag = false; // call is running
let mutedFlag = false;
let busyFlag = false; // thinking or speaking — recognition paused
let lastSpokenKey: string | number | null = null;
let speakRaf = 0;
let stopWatcher: (() => void) | null = null;

export const voiceCall = {
  get active() {
    return ui.active;
  },
  get status() {
    return ui.status;
  },
  get muted() {
    return ui.muted;
  },
  get error() {
    return ui.error;
  },
  get interim() {
    return ui.interim;
  },
  get agentId() {
    return ui.agentId;
  },
};

/** Most recent assistant message in an agent's thread, with a stable key. */
function lastAssistant(agentId: string): { text: string; key: string | number } | null {
  const msgs = agentChat[agentId]?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as { role?: string; timestamp?: number };
    if (m.role !== 'user') {
      return { text: extractText(msgs[i]) ?? '', key: m.timestamp ?? `idx-${msgs.length}-${i}` };
    }
  }
  return null;
}

function setStatus(s: AgentVoiceState) {
  ui.status = s;
}

function startRecognition() {
  if (!activeFlag || mutedFlag || busyFlag || !recog) return;
  try {
    recog.start();
  } catch {
    /* already started — ignore */
  }
}

function handleFinal(text: string) {
  const clean = text.trim();
  if (!clean) return;
  busyFlag = true;
  try {
    recog?.stop();
  } catch {
    /* ignore */
  }
  ui.interim = '';
  setStatus('thinking');
  // Dispatch through the SAME agent + main session as text chat.
  if (ui.agentId) sendVoiceTurn(ui.agentId, clean);
}

/**
 * Subscribe to agent-reply-final events and speak the reply. Driven by the
 * gateway's chat 'final' handler (after history reload) rather than reactivity,
 * so it fires reliably and the call keeps driving itself regardless of which
 * page (if any) is mounted — the user can navigate away mid-call.
 */
function startReplyWatcher(agentId: string) {
  stopWatcher?.();
  stopWatcher = onAgentReplyFinal((repliedAgentId) => {
    if (repliedAgentId !== ui.agentId) return;
    const last = lastAssistant(agentId);
    if (last && last.text) void speakReply(last.text, last.key);
  });
}

/**
 * Start a call against `agentId`. The call is self-contained: transcribed
 * speech is dispatched via `sendVoiceTurn` and replies are spoken from a
 * module-level watcher, so it survives navigation away from the call UI.
 */
export function startCall(agentId: string): void {
  ui.error = null;
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    ui.error = 'This browser has no Web Speech API. Use Chrome or Edge.';
    return;
  }
  ui.agentId = agentId;
  // Seed with the current last assistant message so we don't re-speak history.
  lastSpokenKey = lastAssistant(agentId)?.key ?? null;

  // wawa-lipsync owns its own AudioContext; instantiating here (inside the
  // call-button click gesture) keeps it unblocked by autoplay policy.
  if (!lipsync) lipsync = new Lipsync({ fftSize: 1024, historySize: 60 });

  const r = new Ctor();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e: SpeechRecognitionEvent) => {
    if (mutedFlag || busyFlag) return;
    let finalText = '';
    let interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interimText += res[0].transcript;
    }
    ui.interim = interimText;
    if (finalText.trim()) handleFinal(finalText);
  };
  r.onend = () => {
    // Chrome stops recognition periodically; restart if we should be listening.
    if (activeFlag && !mutedFlag && !busyFlag) startRecognition();
  };
  r.onerror = (ev: Event) => {
    const err = (ev as unknown as { error?: string }).error;
    if (err && err !== 'no-speech' && err !== 'aborted') ui.error = `speech: ${err}`;
  };
  recog = r;

  activeFlag = true;
  busyFlag = false;
  mutedFlag = false;
  ui.active = true;
  ui.muted = false;
  setStatus('listening');
  startRecognition();
  startReplyWatcher(agentId);
}

export function endCall(): void {
  activeFlag = false;
  busyFlag = false;
  cancelAnimationFrame(speakRaf);
  stopWatcher?.();
  stopWatcher = null;
  try {
    recog?.abort();
  } catch {
    /* ignore */
  }
  recog = null;
  lastSpokenKey = null;
  ui.agentId = null;
  mouth.open = REST_MOUTH.open;
  mouth.width = REST_MOUTH.width;
  ui.active = false;
  ui.muted = false;
  ui.interim = '';
  setStatus('idle');
}

export function toggleMute(): void {
  mutedFlag = !mutedFlag;
  ui.muted = mutedFlag;
  if (mutedFlag) {
    try {
      recog?.stop();
    } catch {
      /* ignore */
    }
    if (!busyFlag) setStatus('idle');
  } else if (!busyFlag) {
    setStatus('listening');
    startRecognition();
  }
}

/**
 * Speak an assistant reply and lip-sync the avatar. Deduped by `key` so the
 * page can call it whenever the last assistant message changes. No-op when the
 * call isn't active or this reply was already spoken.
 */
export async function speakReply(text: string, key: string | number): Promise<void> {
  if (!activeFlag || !lipsync) return;
  if (key === lastSpokenKey) return;
  const clean = text.trim();
  if (!clean) return;
  lastSpokenKey = key;

  let url: string | null = null;
  try {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    lipsync.connectAudio(audio);

    const tick = () => {
      if (!lipsync) return;
      lipsync.processAudio();
      const target = visemeToMouth(lipsync.viseme);
      mouth.open += (target.open - mouth.open) * 0.5;
      mouth.width += (target.width - mouth.width) * 0.3;
      speakRaf = requestAnimationFrame(tick);
    };

    busyFlag = true;
    setStatus('speaking');
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      speakRaf = requestAnimationFrame(tick);
    });
  } catch (e) {
    ui.error = String(e);
  } finally {
    cancelAnimationFrame(speakRaf);
    mouth.open = REST_MOUTH.open;
    mouth.width = REST_MOUTH.width;
    if (url) URL.revokeObjectURL(url);
    busyFlag = false;
    if (activeFlag) {
      setStatus(mutedFlag ? 'idle' : 'listening');
      startRecognition();
    }
  }
}
