import { getConsoleBuffer, type ConsoleEntry } from '$lib/utils/console-interceptor';
import { conn } from '$lib/state/gateway/connection.svelte';
import { gw } from '$lib/state/gateway/gateway-data.svelte';
import { ui } from './ui.svelte';
import { toaster, toastSuccess, toastError } from './toast.svelte';
import { hostsState } from '$lib/state/features/hosts.svelte';
import * as m from '$lib/paraglide/messages';
declare const __APP_VERSION__: string;
const hubVersion = __APP_VERSION__;

export type BugReportPhase =
  | 'idle'
  | 'capturing'
  | 'previewing'
  | 'minimized'
  | 'submitting'
  | 'success'
  | 'error';

export const bugReporter = $state({
  phase: 'idle' as BugReportPhase,
  screenshotDataUrl: null as string | null,
  pastedImages: [] as string[],
  consoleLogs: [] as ConsoleEntry[],
  severity: 'medium' as 'critical' | 'high' | 'medium' | 'low',
  comment: '',
  logsCollapsed: true,
  issueUrl: null as string | null,
  errorMessage: null as string | null,
  flashVisible: false,
  stateSnapshot: null as Record<string, unknown> | null,
});

function collectStateSnapshot(): Record<string, unknown> {
  const gatewayVersion = gw.hello?.server?.version ?? null;
  const gatewayCommit = gw.hello?.server?.commit ?? null;

  return {
    url: typeof window !== 'undefined' ? window.location.href : '',
    viewport:
      typeof window !== 'undefined'
        ? { width: window.innerWidth, height: window.innerHeight }
        : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    connected: conn.connected,
    connecting: conn.connecting,
    activeHostId: hostsState.activeHostId,
    selectedAgentId: ui.selectedAgentId,
    timestamp: new Date().toISOString(),
    services: {
      minion_hub: `v${hubVersion}`,
      ...(gatewayVersion
        ? { gateway: gatewayCommit ? `v${gatewayVersion}.${gatewayCommit}` : `v${gatewayVersion}` }
        : {}),
    },
  };
}

export async function captureSnapshot(): Promise<void> {
  bugReporter.phase = 'capturing';

  // Grab console logs + state immediately (before any async work)
  bugReporter.consoleLogs = getConsoleBuffer();
  bugReporter.stateSnapshot = collectStateSnapshot();

  // Capture screenshot using native Screen Capture API
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as MediaTrackConstraints,
      audio: false,
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);

    const track = stream.getVideoTracks()[0];

    // Start the video stream
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    // Wait for the picker UI to fully dismiss, then flash + capture
    await new Promise((r) => setTimeout(r, 500));

    // Flash the screen
    bugReporter.flashVisible = true;
    await new Promise((r) => setTimeout(r, 80));

    // Grab the frame
    await new Promise((r) => requestAnimationFrame(r));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    track.stop();
    video.srcObject = null;

    bugReporter.screenshotDataUrl = canvas.toDataURL('image/png');

    // Let the flash fade out
    setTimeout(() => {
      bugReporter.flashVisible = false;
    }, 240);
  } catch (err) {
    bugReporter.flashVisible = false;
    // User cancelled the picker or API unavailable
    if (err instanceof Error && err.name === 'NotAllowedError') {
      bugReporter.screenshotDataUrl = null;
    } else {
      console.error('[BugReporter] Screenshot capture failed:', err);
      bugReporter.screenshotDataUrl = null;
    }
  }

  bugReporter.phase = 'previewing';
}

export function minimizeReport(): void {
  if (bugReporter.phase === 'previewing') {
    bugReporter.phase = 'minimized';
  }
}

export function restoreReport(): void {
  if (bugReporter.phase === 'minimized') {
    bugReporter.phase = 'previewing';
  }
}

let lastEscAt = 0;

export function handleEsc(): void {
  if (bugReporter.phase === 'previewing') {
    const now = Date.now();
    if (now - lastEscAt < 500) {
      // Double-ESC: discard
      cancelReport();
    } else {
      // Single ESC: minimize
      minimizeReport();
    }
    lastEscAt = now;
  } else if (bugReporter.phase === 'minimized') {
    restoreReport();
  }
}

export function handlePaste(e: ClipboardEvent): void {
  if (bugReporter.phase !== 'previewing' && bugReporter.phase !== 'minimized') return;
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (!item.type.startsWith('image/')) continue;
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) continue;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        bugReporter.pastedImages.push(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }
}

export function removePastedImage(index: number): void {
  bugReporter.pastedImages.splice(index, 1);
}

export async function submitReport(): Promise<void> {
  // Close the card immediately, show a loading toast
  const loadingId = toaster.create({
    title: m.bug_submitting(),
    type: 'loading',
    duration: Infinity,
  });
  const snapshot = {
    screenshot: bugReporter.screenshotDataUrl,
    pastedImages: bugReporter.pastedImages.length > 0 ? [...bugReporter.pastedImages] : undefined,
    consoleLogs: bugReporter.consoleLogs,
    severity: bugReporter.severity,
    comment: bugReporter.comment,
    stateSnapshot: bugReporter.stateSnapshot,
  };
  cancelReport();

  try {
    const res = await fetch('/api/bugs/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });

    const data = await res.json();
    toaster.dismiss(loadingId);

    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? `Server returned ${res.status}`);
    }

    if (data.githubIssueUrl) {
      toastSuccess(m.bug_reported(), m.bug_issueCreated(), { duration: 3000 });
    } else {
      toastSuccess(m.bug_saved(), m.bug_savedLocally(), { duration: 3000 });
    }
  } catch (err) {
    toaster.dismiss(loadingId);
    const msg = err instanceof Error ? err.message : m.bug_unknownError();
    toastError(m.bug_reportFailed(), msg, { duration: 5000 });
  }
}

export function cancelReport(): void {
  bugReporter.phase = 'idle';
  bugReporter.screenshotDataUrl = null;
  bugReporter.pastedImages = [];
  bugReporter.consoleLogs = [];
  bugReporter.severity = 'medium';
  bugReporter.comment = '';
  bugReporter.logsCollapsed = true;
  bugReporter.issueUrl = null;
  bugReporter.errorMessage = null;
  bugReporter.flashVisible = false;
  bugReporter.stateSnapshot = null;
}
