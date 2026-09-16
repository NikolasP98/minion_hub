import { PluginBridge } from '@nikolasp98/plugin-ui-bridge';

export interface ArtifactRenderer {
  render: (context: unknown) => void;
  fail: (message: string) => void;
}

/** Artifact-only projection/lifecycle; the package owns the entire wire protocol. */
export function mount(renderer: ArtifactRenderer): { dispose: () => void } {
  let active: PluginBridge | null = null;
  let disposed = false;
  const fail = () => {
    try {
      renderer.fail('artifact unavailable');
    } catch {
      /* A broken renderer cannot restart transport or expose its exception. */
    }
  };
  const hints = new URLSearchParams(location.hash.slice(1)).getAll('hostOrigin');
  const origin = hints.length === 1 && hints[0] !== '' ? hints[0] : null;
  const project = (message: { theme: 'light' | 'dark'; tokens: Record<string, string> }) => {
    for (const [key, value] of Object.entries(message.tokens)) {
      if (key.startsWith('--')) document.documentElement.style.setProperty(key, value);
    }
    // TODO(handoff): Qualify host theme snapshots separately; this preserves only its binary signal,
    // not a design-system theme identity. See proposals/2026-09-08-platform-qc-remediation.md (14-07).
    document.documentElement.classList.toggle('dark', message.theme === 'dark');
  };
  const retire = () => {
    const previous = active;
    active = null;
    previous?.dispose();
  };
  const start = () => {
    if (disposed || active) return;
    if (origin === null) {
      fail();
      return;
    }
    const bridge = new PluginBridge({
      self: window,
      parent: window.parent,
      expectedHostOrigin: origin,
    });
    active = bridge;
    let requested = false;
    const current = () => !disposed && active === bridge;
    bridge.onHello((message) => {
      if (!current()) return;
      try {
        project(message);
        if (requested) return;
        requested = true;
        void bridge
          .call('hub.artifact.context.get', {})
          .then((context) => {
            if (current()) renderer.render(context);
          })
          .catch(() => {
            if (current()) fail();
          });
      } catch {
        if (current()) fail();
      }
    });
    bridge.onThemeChange((message) => {
      if (!current()) return;
      try {
        project(message);
      } catch {
        if (current()) fail();
      }
    });
    try {
      bridge.notifyReady();
    } catch {
      if (current()) {
        retire();
        fail();
      }
    }
  };
  const onPageHide = () => retire();
  // TODO(handoff): Qualify native opaque-iframe crypto and persisted restoration in 14-07 Task 3;
  // synthetic lifecycle tests are not BFCache proof. See proposals/2026-09-08-platform-qc-remediation.md.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) start();
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  start();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      retire();
    },
  };
}
