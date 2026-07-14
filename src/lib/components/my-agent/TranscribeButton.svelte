<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { fly } from 'svelte/transition';
  import {
    Mic,
    MicOff,
    ChevronDown,
    MonitorSpeaker,
    Loader2,
    Sparkles,
    Check,
    X,
    Trash2,
  } from 'lucide-svelte';
  import {
    txPrefs,
    TX_INTENTS,
    setAutoPolish,
    setIntent,
    speechLang,
    type TxIntent,
  } from '$lib/state/features/transcription-prefs.svelte';

  // Emits transcript text to the parent. `onfinal` fires with each finalized
  // segment; `oninterim` streams the live (not-yet-final) phrase. The parent owns
  // buffering/commit; it may also pass polish/discard actions for the dropdown.
  let {
    onfinal,
    oninterim,
    onpolish,
    ondiscard,
    hasPending,
    detectedLang,
    compact = false,
    allowTab = true,
  }: {
    onfinal: (text: string) => void;
    oninterim?: (text: string) => void;
    /** Polish the parent's pending buffer (dropdown action). */
    onpolish?: () => void;
    /** Discard the parent's pending buffer (dropdown action). */
    ondiscard?: () => void;
    /** Whether the parent currently holds an uncommitted transcript. */
    hasPending?: () => boolean;
    /** Detected note language — used when the language pref is 'auto'. */
    detectedLang?: () => 'es' | 'en' | null;
    compact?: boolean;
    /** Whether to offer the audio-sources picker (advanced). */
    allowTab?: boolean;
  } = $props();

  let active = $state(false);
  let busy = $state(false);
  let error = $state('');
  let menuOpen = $state(false);
  // A pre-picked tab/computer audio source (armed but not started).
  let armedDisp = $state<MediaStream | null>(null);

  // ── Web Speech API (mic-only, real-time, no key) ───────────────────────────
  interface SRResult {
    0: { transcript: string };
    isFinal: boolean;
  }
  interface SREvent extends Event {
    resultIndex: number;
    results: { length: number; [i: number]: SRResult };
  }
  interface SR extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((e: SREvent) => void) | null;
    onerror: ((e: Event) => void) | null;
    onend: (() => void) | null;
  }
  type SRCtor = new () => SR;

  function srCtor(): SRCtor | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  let recog: SR | null = null;

  function startWebSpeech() {
    const Ctor = srCtor();
    if (!Ctor) {
      error = m.tx_notSupported();
      active = false;
      return;
    }
    recog = new Ctor();
    // Explicit pref wins; on 'auto' follow the note's detected language.
    const auto = detectedLang?.();
    recog.lang =
      speechLang() ||
      (auto === 'es' ? 'es-ES' : auto === 'en' ? 'en-US' : '') ||
      navigator.language ||
      'en-US';
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          onfinal(text.trim() + ' ');
          live = '';
        } else {
          live += text;
        }
      }
      oninterim?.(live);
    };
    recog.onerror = (e) => {
      const err = e as Event & { error?: string };
      if (err.error === 'no-speech' || err.error === 'aborted') return;
      error = m.tx_error({ error: err.error ?? 'unknown' });
    };
    recog.onend = () => {
      // Web Speech stops itself periodically — restart while active.
      if (active && !armedDisp) {
        try {
          recog?.start();
        } catch {
          /* already started */
        }
      }
    };
    try {
      recog.start();
    } catch {
      /* already running */
    }
  }

  function stopWebSpeech() {
    const r = recog;
    recog = null;
    try {
      r?.stop();
    } catch {
      /* ignore */
    }
  }

  // ── Server STT on mixed (mic + pre-picked source) audio ────────────────────
  let micStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;
  let cycleTimer: ReturnType<typeof setTimeout> | null = null;
  const CHUNK_MS = 5000;

  async function startServerStt() {
    busy = true;
    error = '';
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tabAudio = armedDisp?.getAudioTracks() ?? [];
      if (tabAudio.length === 0) {
        // Armed source was lost — fall back to mic-only Web Speech.
        busy = false;
        startWebSpeech();
        void startMeter(micStream);
        return;
      }
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(micStream).connect(dest);
      audioCtx.createMediaStreamSource(new MediaStream(tabAudio)).connect(dest);
      busy = false;
      void startMeter(micStream);
      recordCycle(dest.stream);
    } catch (e) {
      error =
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? m.tx_permissionDenied()
          : m.tx_couldNotStart();
      await stopServerStt();
      active = false;
      busy = false;
    }
  }

  function recordCycle(stream: MediaStream) {
    if (!active) return;
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder = rec;
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
      void postChunk(blob);
      if (active) recordCycle(stream);
    };
    rec.start();
    cycleTimer = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }, CHUNK_MS);
  }

  async function postChunk(blob: Blob) {
    if (blob.size < 1024) return; // near-silence
    const fd = new FormData();
    fd.append('file', blob, 'chunk.webm');
    try {
      const res = await fetch('/api/notes/transcribe', { method: 'POST', body: fd });
      if (res.status === 503) {
        error = m.tx_setOpenaiApiKey();
        return;
      }
      if (!res.ok) return;
      const { text } = (await res.json()) as { text: string };
      if (text) onfinal(text + ' ');
    } catch {
      /* drop chunk */
    }
  }

  async function stopServerStt() {
    if (cycleTimer) clearTimeout(cycleTimer);
    cycleTimer = null;
    try {
      recorder?.stop();
    } catch {
      /* ignore */
    }
    recorder = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    try {
      await audioCtx?.close();
    } catch {
      /* ignore */
    }
    audioCtx = null;
  }

  // ── Live audio meter (for the recording island) ────────────────────────────
  const BARS = 28;
  let levels = $state<number[]>(new Array(BARS).fill(0));
  let analyser: AnalyserNode | null = null;
  let meterCtx: AudioContext | null = null;
  let meterStream: MediaStream | null = null;
  let rafId = 0;

  async function startMeter(existing?: MediaStream) {
    try {
      meterStream = existing ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      meterCtx = new AudioContext();
      const src = meterCtx.createMediaStreamSource(meterStream);
      analyser = meterCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(data);
        const next = new Array(BARS);
        const step = Math.max(1, Math.floor(data.length / BARS));
        for (let i = 0; i < BARS; i++) next[i] = Math.min(1, (data[i * step] ?? 0) / 190);
        levels = next;
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch {
      /* meter is best-effort; transcription still works */
    }
  }

  function stopMeter() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    analyser = null;
    // Only stop a stream we opened ourselves (not the shared server-STT mic).
    if (meterStream && meterStream !== micStream) meterStream.getTracks().forEach((t) => t.stop());
    meterStream = null;
    try {
      meterCtx?.close();
    } catch {
      /* ignore */
    }
    meterCtx = null;
    levels = new Array(BARS).fill(0);
  }

  // ── Public control ─────────────────────────────────────────────────────────
  function start() {
    error = '';
    oninterim?.('');
    active = true;
    if (armedDisp) void startServerStt();
    else {
      startWebSpeech();
      void startMeter();
    }
  }

  async function stop() {
    active = false;
    oninterim?.('');
    stopWebSpeech();
    stopMeter();
    await stopServerStt();
  }

  function toggle() {
    if (active) void stop();
    else start();
  }

  // ── Audio sources — pre-pick a tab/computer source (does NOT start) ────────
  async function pickAudioSource() {
    menuOpen = false;
    try {
      // Chrome requires video:true to offer the tab picker + "share tab audio".
      const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      disp.getVideoTracks().forEach((t) => t.stop());
      if (disp.getAudioTracks().length === 0) {
        disp.getTracks().forEach((t) => t.stop());
        error = m.tx_noTabAudio();
        return;
      }
      armedDisp?.getTracks().forEach((t) => t.stop());
      armedDisp = disp;
      disp.getAudioTracks()[0].addEventListener('ended', () => {
        if (armedDisp === disp) armedDisp = null;
      });
    } catch {
      /* user cancelled the picker */
    }
  }

  function clearAudioSource() {
    armedDisp?.getTracks().forEach((t) => t.stop());
    armedDisp = null;
  }

  function chooseIntent(i: TxIntent) {
    setIntent(i);
  }

  $effect(() => {
    // Cleanup on unmount.
    return () => {
      active = false;
      stopWebSpeech();
      stopMeter();
      void stopServerStt();
      armedDisp?.getTracks().forEach((t) => t.stop());
    };
  });
</script>

<div class="tx" class:compact class:menuparent={menuOpen}>
  <div class="tx-split" class:on={active}>
    <Button
      type="button"
      class="tx-main"
      title={active ? m.tx_stopTranscription() : m.tx_transcribeSpeech()}
      aria-label={active ? m.tx_stopTranscription() : m.tx_startTranscription()}
      aria-pressed={active}
      onclick={toggle}
    >
      {#if busy}<Loader2 size={compact ? 13 : 15} class="spin" />
      {:else if active}<Mic size={compact ? 13 : 15} />
      {:else}<MicOff size={compact ? 13 : 15} />{/if}
      {#if !compact}<span>{active ? m.tx_listening() : m.tx_transcribe()}</span>{/if}
    </Button>
    {#if !compact}
      <Button
        type="button"
        class="tx-caret {menuOpen ? 'open' : ''}"
        title={m.tx_options()}
        aria-label={m.tx_options()}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
      >
        <ChevronDown size={13} />
      </Button>
    {/if}
  </div>

  {#if menuOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tx-menu" role="menu" tabindex="-1" onmousedown={(e) => e.preventDefault()}>
      <!-- Actions (top) -->
      {#if hasPending?.()}
        <Button
          type="button"
          role="menuitem"
          class="tx-mi"
          onclick={() => {
            menuOpen = false;
            onpolish?.();
          }}
        >
          <Sparkles size={13} />
          {m.tx_polishNow()}
        </Button>
        <Button
          type="button"
          role="menuitem"
          class="tx-mi"
          onclick={() => {
            menuOpen = false;
            ondiscard?.();
          }}
        >
          <Trash2 size={13} />
          {m.tx_discardPending()}
        </Button>
        <div class="tx-sep"></div>
      {/if}

      <!-- Toggles / settings (bottom) -->
      <Button
        type="button"
        role="menuitemcheckbox"
        aria-checked={txPrefs.autoPolish}
        class="tx-mi"
        onclick={() => setAutoPolish(!txPrefs.autoPolish)}
      >
        <span class="tx-check" class:on={txPrefs.autoPolish}
          >{#if txPrefs.autoPolish}<Check size={11} />{/if}</span
        >
        {m.tx_autoPolish()}
      </Button>

      <div class="tx-group-label">{m.tx_intent()}</div>
      {#each TX_INTENTS as it (it.id)}
        <Button
          type="button"
          role="menuitemradio"
          aria-checked={txPrefs.intent === it.id}
          class="tx-mi intent"
          title={it.hint}
          onclick={() => chooseIntent(it.id)}
        >
          <span class="tx-radio" class:on={txPrefs.intent === it.id}></span>
          {it.label}
        </Button>
      {/each}

      {#if allowTab}
        <div class="tx-sep"></div>
        <Button type="button" role="menuitem" class="tx-mi" onclick={pickAudioSource}>
          <MonitorSpeaker size={13} />
          {armedDisp ? m.tx_changeAudioSource() : m.tx_audioSources()}
        </Button>
        {#if armedDisp}
          <Button type="button" role="menuitem" class="tx-mi sub" onclick={clearAudioSource}>
            <X size={12} />
            {m.tx_removeSource()}
          </Button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if error}
    <span class="terr" role="alert">{error}</span>
  {/if}
</div>

{#if menuOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tx-scrim" onpointerdown={() => (menuOpen = false)}></div>
{/if}

{#if active}
  <!-- Recording island — slides in from the top with live audio + a pulsing dot. -->
  <div
    class="rec-island"
    transition:fly={{ y: -40, duration: 220 }}
    role="status"
    aria-label={m.tx_recording()}
  >
    <span class="rec-dot"></span>
    <span class="rec-label">{armedDisp ? m.tx_recordingWithSource() : m.tx_recording()}</span>
    <div class="rec-bars" aria-hidden="true">
      {#each levels as lv, i (i)}
        <span class="rec-bar" style:height="{Math.max(8, lv * 100)}%"></span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .tx {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  /* Split button: [ mic | ▼ ] */
  .tx-split {
    display: inline-flex;
    align-items: stretch;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    transition:
      border-color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .tx-split.on {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }
  :global(.tx-main) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-caption);
    font-family: inherit;
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
    transition: color var(--duration-fast) ease;
  }
  .compact :global(.tx-main) {
    padding: var(--space-1) var(--space-1);
  }
  :global(.tx-main):hover {
    color: var(--color-foreground);
  }
  .tx-split.on :global(.tx-main) {
    color: var(--color-foreground);
  }
  .tx-split.on :global(.tx-main) :global(svg) {
    animation: pulse 1.4s ease-in-out infinite;
  }
  :global(.tx-caret) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    cursor: pointer;
    background: transparent;
    border: none;
    border-left: 1px solid var(--color-border);
    color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.tx-caret):hover,
  :global(.tx-caret.open) {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
  }

  /* Dropdown menu */
  .tx-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--layer-debug);
    min-width: 230px;
    display: flex;
    flex-direction: column;
    padding: var(--space-1);
    border-radius: var(--radius-xl);
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-overlay);
  }
  .tx-scrim {
    position: fixed;
    inset: 0;
    z-index: var(--layer-debug);
  }
  :global(.tx-mi) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-caption);
    font-family: inherit;
    text-align: left;
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
    transition:
      background var(--duration-fast) ease,
      color var(--duration-fast) ease;
  }
  :global(.tx-mi):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  :global(.tx-mi.sub) {
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
    padding-left: var(--space-3);
  }
  :global(.tx-mi.intent) {
    padding-left: var(--space-3);
  }
  :global(.tx-mi) :global(svg) {
    color: var(--color-accent);
    flex-shrink: 0;
  }
  .tx-sep {
    height: 1px;
    margin: var(--space-1) var(--space-1);
    background: var(--color-border);
  }
  .tx-group-label {
    padding: var(--space-1) var(--space-2) var(--space-0-5);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
  }
  .tx-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: var(--radius-sm);
    border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
    color: var(--color-bg2);
    flex-shrink: 0;
  }
  .tx-check.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .tx-check :global(svg) {
    color: var(--color-bg2);
  }
  .tx-radio {
    width: 13px;
    height: 13px;
    border-radius: var(--radius-full);
    border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
    flex-shrink: 0;
    position: relative;
  }
  .tx-radio.on {
    border-color: var(--color-accent);
  }
  .tx-radio.on::after {
    content: '';
    position: absolute;
    inset: 2.5px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }

  .terr {
    font-size: var(--font-size-caption);
    color: var(--color-accent);
    flex-basis: 100%;
  }
  :global(.tx .spin) {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  /* Recording island (top-center overlay) */
  .rec-island {
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--layer-debug);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-bg2) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
    box-shadow: var(--shadow-overlay);
    backdrop-filter: blur(8px);
  }
  .rec-dot {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-full);
    background: var(--color-brand);
    box-shadow: var(--shadow-elevation-2);
    animation: rec-pulse 1.3s ease-out infinite;
    flex-shrink: 0;
  }
  @keyframes rec-pulse {
    0% {
      box-shadow: var(--shadow-elevation-2);
    }
    70% {
      box-shadow: var(--shadow-elevation-2);
    }
    100% {
      box-shadow: var(--shadow-elevation-2);
    }
  }
  .rec-label {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
    white-space: nowrap;
  }
  .rec-bars {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    height: 22px;
    width: 130px;
  }
  .rec-bar {
    flex: 1;
    min-height: 8%;
    border-radius: var(--radius-xs);
    background: linear-gradient(
      to top,
      var(--color-accent),
      color-mix(in srgb, var(--color-accent) 50%, var(--color-foreground))
    );
    transition: height var(--duration-instant) linear;
  }
</style>
