import { getConsoleBuffer, type ConsoleEntry } from '$lib/utils/console-interceptor';
import { conn } from '$lib/state/gateway/connection.svelte';
import { ui } from './ui.svelte';
import { toaster, toastSuccess, toastError } from './toast.svelte';
import { hostsState } from '$lib/state/features/hosts.svelte';

export type BugReportPhase = 'idle' | 'capturing' | 'previewing' | 'submitting' | 'success' | 'error';

export const bugReporter = $state({
  phase: 'idle' as BugReportPhase,
  screenshotDataUrl: null as string | null,
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

export async function submitReport(): Promise<void> {
  // Close the card immediately, show a loading toast
  const loadingId = toaster.create({
    title: 'Submitting bug report...',
    type: 'loading',
    duration: Infinity,
  });
  const snapshot = {
    screenshot: bugReporter.screenshotDataUrl,
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
      toastSuccess('Bug reported', 'GitHub issue created', { duration: 3000 });
    } else {
      toastSuccess('Bug saved', 'Saved locally', { duration: 3000 });
    }
  } catch (err) {
    toaster.dismiss(loadingId);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    toastError('Bug report failed', msg, { duration: 5000 });
  }
}

export function cancelReport(): void {
  bugReporter.phase = 'idle';
  bugReporter.screenshotDataUrl = null;
  bugReporter.consoleLogs = [];
  bugReporter.severity = 'medium';
  bugReporter.comment = '';
  bugReporter.logsCollapsed = true;
  bugReporter.issueUrl = null;
  bugReporter.errorMessage = null;
  bugReporter.flashVisible = false;
  bugReporter.stateSnapshot = null;
}
