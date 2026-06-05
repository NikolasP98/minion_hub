<script lang="ts">
	import { Mic, MicOff, MonitorSpeaker, Loader2 } from 'lucide-svelte';

	// Emits finalized transcript text to insert into the note.
	let {
		onfinal,
		compact = false
	}: { onfinal: (text: string) => void; compact?: boolean } = $props();

	let active = $state(false);
	let includeTab = $state(false);
	let interim = $state('');
	let busy = $state(false);
	let error = $state('');

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
			error = 'Live transcription is not supported in this browser.';
			active = false;
			return;
		}
		recog = new Ctor();
		recog.lang = navigator.language || 'en-US';
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
			interim = live;
		};
		recog.onerror = (e) => {
			const err = e as Event & { error?: string };
			if (err.error === 'no-speech' || err.error === 'aborted') return;
			error = `Transcription error: ${err.error ?? 'unknown'}`;
		};
		recog.onend = () => {
			// Web Speech stops itself periodically — restart while active.
			if (active && !includeTab) {
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

	// ── Server STT on mixed (mic + tab) audio ──────────────────────────────────
	let micStream: MediaStream | null = null;
	let dispStream: MediaStream | null = null;
	let audioCtx: AudioContext | null = null;
	let recorder: MediaRecorder | null = null;
	let cycleTimer: ReturnType<typeof setTimeout> | null = null;
	const CHUNK_MS = 5000;

	async function startServerStt() {
		busy = true;
		error = '';
		try {
			micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			// Chrome requires video:true to offer the tab picker + "share tab audio".
			dispStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
			const tabAudio = dispStream.getAudioTracks();
			// We only need audio — drop the video track to save resources.
			dispStream.getVideoTracks().forEach((t) => t.stop());
			if (tabAudio.length === 0) {
				error = 'No tab audio shared — pick a tab and enable "Share tab audio".';
				await stopServerStt();
				active = false;
				busy = false;
				return;
			}
			// If the user ends the share, stop transcribing.
			tabAudio[0].addEventListener('ended', () => void stop());

			audioCtx = new AudioContext();
			const dest = audioCtx.createMediaStreamDestination();
			audioCtx.createMediaStreamSource(micStream).connect(dest);
			audioCtx.createMediaStreamSource(new MediaStream(tabAudio)).connect(dest);

			busy = false;
			recordCycle(dest.stream);
		} catch (e) {
			error =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Permission denied for mic or screen audio.'
					: 'Could not start system-audio transcription.';
			await stopServerStt();
			active = false;
			busy = false;
		}
	}

	// Record a full, independently-decodable webm clip every CHUNK_MS, post it,
	// then start the next clip (timeslice chunks aren't separately decodable).
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
				error = 'Set OPENAI_API_KEY on the hub to transcribe system audio.';
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
		dispStream?.getTracks().forEach((t) => t.stop());
		micStream = dispStream = null;
		try {
			await audioCtx?.close();
		} catch {
			/* ignore */
		}
		audioCtx = null;
	}

	// ── Public control ─────────────────────────────────────────────────────────
	function start() {
		error = '';
		interim = '';
		active = true;
		if (includeTab) void startServerStt();
		else startWebSpeech();
	}

	async function stop() {
		active = false;
		interim = '';
		stopWebSpeech();
		await stopServerStt();
	}

	function toggle() {
		if (active) void stop();
		else start();
	}

	function onToggleTab() {
		includeTab = !includeTab;
		if (active) {
			// Restart in the new mode.
			void stop().then(() => start());
		}
	}

	$effect(() => {
		// Cleanup on unmount.
		return () => {
			active = false;
			stopWebSpeech();
			void stopServerStt();
		};
	});
</script>

<div class="transcribe" class:compact>
	<button
		type="button"
		class="mic-btn"
		class:on={active}
		title={active ? 'Stop transcription' : 'Transcribe speech into this note'}
		aria-label={active ? 'Stop transcription' : 'Start transcription'}
		aria-pressed={active}
		onclick={toggle}
	>
		{#if busy}<Loader2 size={compact ? 13 : 15} class="spin" />
		{:else if active}<Mic size={compact ? 13 : 15} />
		{:else}<MicOff size={compact ? 13 : 15} />{/if}
		{#if !compact}<span>{active ? 'Listening…' : 'Transcribe'}</span>{/if}
	</button>

	<button
		type="button"
		class="tab-toggle"
		class:on={includeTab}
		title="Also transcribe a browser tab's audio (you'll pick the tab)"
		aria-label="Include tab audio"
		aria-pressed={includeTab}
		onclick={onToggleTab}
	>
		<MonitorSpeaker size={compact ? 12 : 14} />
		{#if !compact}<span>Tab audio</span>{/if}
	</button>

	{#if interim}
		<span class="interim" aria-live="polite">{interim}</span>
	{/if}
	{#if error}
		<span class="terr" role="alert">{error}</span>
	{/if}
</div>

<style>
	.transcribe {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.mic-btn,
	.tab-toggle {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		font-size: 11.5px;
		border-radius: 7px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.55);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
	}
	.compact .mic-btn,
	.compact .tab-toggle {
		padding: 4px;
	}
	.mic-btn:hover,
	.tab-toggle:hover {
		color: rgba(255, 255, 255, 0.9);
	}
	.mic-btn.on {
		color: #fff;
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
	}
	.mic-btn.on :global(svg) {
		animation: pulse 1.4s ease-in-out infinite;
	}
	.tab-toggle.on {
		color: rgba(167, 139, 250, 1);
		background: rgba(167, 139, 250, 0.16);
		border-color: rgba(167, 139, 250, 0.45);
	}
	.interim {
		font-size: 11.5px;
		font-style: italic;
		color: rgba(255, 255, 255, 0.45);
		max-width: 100%;
	}
	.terr {
		font-size: 11px;
		color: var(--color-accent);
		flex-basis: 100%;
	}
	:global(.transcribe .spin) {
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
</style>
