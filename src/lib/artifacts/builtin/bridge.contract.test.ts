import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { HostBridge } from '../../plugins/bridge-protocol';
import {
  buildCandidate,
  checkArtifacts,
  replaceRegion,
  validateOutput,
  validateGraph,
  HELPERS,
  assertDigest,
  digest,
  START,
  END,
  ENTRY,
} from '../../../../scripts/artifacts/build-inline-bridge.mjs';

const HOST = 'https://hub.example';
const names = ['overview', 'triage', 'artifact-builder'] as const;
type Builtin = (typeof names)[number];
const htmlFor = (name: Builtin) =>
  readFileSync(fileURLToPath(new URL(`./${name}/index.html`, import.meta.url)), 'utf8');
const scripts = (html: string) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
const drain = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
class Peer {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  posted: Array<Record<string, unknown>> = [];
  other!: Peer;
  parent!: Peer;
  constructor(readonly origin: string) {}
  addEventListener(type: string, fn: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(fn);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, event: unknown) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  emit(data: unknown, origin = this.other.origin, source: Peer = this.other) {
    this.dispatch('message', { data, origin, source });
  }
  postMessage(data: Record<string, unknown>, target: string) {
    const copied = structuredClone(data);
    this.posted.push(copied);
    if (target === '*' || target === this.origin) queueMicrotask(() => this.emit(copied));
  }
  get window() {
    return this as unknown as Window;
  }
}
const hello = {
  theme: 'dark' as const,
  tokens: { '--color-canvas': 'black', '--radius': '9px' },
  gatewayUrl: '',
  authToken: '',
};
function fixture(name: Builtin, hash = `#hostOrigin=${encodeURIComponent(HOST)}`) {
  const parent = new Peer(HOST),
    child = new Peer('null');
  parent.other = child;
  child.other = parent;
  child.parent = parent;
  const nodes = new Map<
    string,
    { hidden: boolean; textContent: unknown; innerHTML: string; className: string }
  >();
  const node = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, {
        hidden: id === 'app',
        textContent: id === 'state' ? 'Loading…' : '',
        innerHTML: '',
        className: '',
      });
    return nodes.get(id)!;
  };
  const properties = new Map<string, string>(),
    classes = new Set<string>();
  const document = {
    getElementById: node,
    documentElement: {
      style: { setProperty: (key: string, value: string) => properties.set(key, value) },
      classList: {
        toggle: (key: string, value: boolean) => (value ? classes.add(key) : classes.delete(key)),
      },
    },
  };
  let namespace = 0;
  const context = createContext(
    {
      window: child,
      parent,
      location: { hash },
      document,
      URL,
      URLSearchParams,
      structuredClone,
      crypto: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(++namespace);
          return bytes;
        },
      },
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  const forward = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({
    agentName: 'Synthetic',
    status: { state: 'active' },
  }));
  const host = new HostBridge({
    self: parent.window,
    target: child.window,
    pluginOrigin: HOST,
    sandboxed: true,
    forwardRpc: forward,
  });
  const start = () => {
    for (const script of scripts(htmlFor(name))) runInContext(script, context, { timeout: 1000 });
  };
  const dispose = () => {
    child.dispatch('pagehide', { persisted: false });
    host.dispose();
  };
  return { parent, child, context, forward, host, node, properties, classes, start, dispose };
}

describe.each(names)('actual builtin %s', (name) => {
  it('ignores a sibling hello even when its origin matches the parent', async () => {
    const f = fixture(name);
    try {
      f.start();
      await drain();
      f.child.emit({ type: 'host:hello', ...hello }, HOST, new Peer(HOST));
      await drain();
      expect(f.parent.posted.filter((frame) => frame.type === 'plugin:rpc-request')).toHaveLength(
        0,
      );
      expect(f.node('app').hidden).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it('makes one context request across repeated supported hello', async () => {
    const f = fixture(name);
    try {
      f.host.sendHelloOnReady(hello);
      f.start();
      await drain();
      f.child.emit({ type: 'host:hello', ...hello });
      await drain();
      expect(f.forward).toHaveBeenCalledTimes(1);
      expect(f.forward).toHaveBeenCalledWith('hub.artifact.context.get', {});
    } finally {
      f.dispose();
    }
  });
  it('does not render a context response after pagehide', async () => {
    const f = fixture(name);
    let reply!: (value: unknown) => void;
    f.forward.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    try {
      f.host.sendHelloOnReady(hello);
      f.start();
      await drain();
      f.child.dispatch('pagehide', { persisted: true });
      reply({ agentName: 'Obsolete' });
      await drain();
      expect(f.node('app').hidden).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it.each([undefined, 1])(
    'accepts supported hello version %s and preserves full renderer inputs',
    async (protocolVersion) => {
      const f = fixture(name);
      if (protocolVersion === undefined) {
        const post = f.child.postMessage.bind(f.child);
        vi.spyOn(f.child, 'postMessage').mockImplementation((frame, target) => {
          const copy = { ...frame };
          if (copy.type === 'host:hello') delete copy.protocolVersion;
          post(copy, target);
        });
      }
      const payload = {
        agentName: 'Synthetic',
        agentRole: 'Role',
        agentDescription: 'Description',
        trigger: 'manual',
        status: { state: 'active', detail: 'Detail', stats: { sent: 7, failed: 2, skipped: 1 } },
        data: {
          counts: { total: 11, high: 4, notified: 3, responded: 2 },
          recent: [
            {
              severity: 'high',
              category: '<category>',
              summary: '<summary>',
              createdAt: Date.now(),
            },
          ],
        },
        vars: {
          'artifacts.builtCount': 12,
          'artifacts.recent': [
            { title: '<title>', agentId: 'a', version: 2, updatedAt: Date.now() },
          ],
        },
      };
      f.forward.mockResolvedValue(payload);
      try {
        f.start();
        await drain();
        f.host.sendHelloOnReady(hello);
        await drain();
        // The actual host's initial hello is projected to legacy only for the omitted-version case.
        f.child.emit({
          type: 'host:hello',
          ...hello,
          ...(protocolVersion === undefined ? {} : { protocolVersion }),
        });
        await drain();
        expect(f.forward).toHaveBeenCalledTimes(1);
        expect(f.node('app').hidden).toBe(false);
        if (name === 'overview') {
          expect(f.node('name').textContent).toBe('Synthetic');
          expect(f.node('stats').innerHTML).toContain('7');
        }
        if (name === 'triage') {
          expect(f.node('cnt-total').textContent).toBe(11);
          expect(f.node('alerts-list').innerHTML).toContain('&lt;summary&gt;');
        }
        if (name === 'artifact-builder') {
          expect(f.node('built-count').textContent).toBe('12');
          expect(f.node('recent-list').innerHTML).toContain('&lt;title&gt;');
        }
      } finally {
        f.dispose();
        vi.restoreAllMocks();
      }
    },
  );
  it.each([
    { ...hello, protocolVersion: 2 },
    { ...hello, protocolVersion: null },
    { ...hello, theme: 'invalid' },
    { ...hello, tokens: { '--x': 2 } },
    { ...hello, authToken: false },
  ])('ignores malformed or unsupported hello %#', async (fields) => {
    const f = fixture(name);
    try {
      f.start();
      await drain();
      f.child.emit({ type: 'host:hello', ...fields });
      await drain();
      expect(f.parent.posted.filter((frame) => frame.type === 'plugin:rpc-request')).toHaveLength(
        0,
      );
      expect(f.node('app').hidden).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it('ignores wrong origin and malformed envelopes without RPC or rendering', async () => {
    const f = fixture(name);
    try {
      f.start();
      await drain();
      f.child.emit({ type: 'host:hello', ...hello }, 'https://other.example');
      for (const value of [null, [], 42, 'hello', { type: 'host:unknown' }]) f.child.emit(value);
      await drain();
      expect(f.forward).not.toHaveBeenCalled();
      expect(f.node('app').hidden).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it.each([
    '',
    '#hostOrigin=',
    '#hostOrigin=*&hostOrigin=https%3A%2F%2Fhub.example',
    '#hostOrigin=*',
    '#hostOrigin=null',
    '#hostOrigin=%2Frelative',
    '#hostOrigin=https%3A%2F%2Fhub.example%2Fpath',
  ])('fails closed for invalid hint %s', async (hash) => {
    const f = fixture(name, hash);
    try {
      f.start();
      await drain();
      expect(f.forward).not.toHaveBeenCalled();
      expect(f.parent.posted).toHaveLength(0);
      expect(f.node('state').textContent).toBe('Could not load: artifact unavailable');
      expect(f.child.listeners.get('message')?.size ?? 0).toBe(0);
    } finally {
      f.dispose();
    }
  });
  it('projects all custom-property families and validated theme updates without another context call', async () => {
    const f = fixture(name);
    try {
      f.host.sendHelloOnReady({
        ...hello,
        tokens: { ...hello.tokens, '--space-custom': '2px', color: 'red' },
      });
      f.start();
      await drain();
      expect(f.properties.get('--radius')).toBe('9px');
      expect(f.properties.get('--space-custom')).toBe('2px');
      expect(f.properties.has('color')).toBe(false);
      f.host.sendThemeChange({ theme: 'light', tokens: { '--color-canvas': 'white' } });
      await drain();
      expect(f.properties.get('--color-canvas')).toBe('white');
      expect(f.properties.get('--radius')).toBe('9px');
      expect(f.classes.has('dark')).toBe(false);
      expect(f.forward).toHaveBeenCalledTimes(1);
    } finally {
      f.dispose();
    }
  });
  it('projects fixed RPC failure and never retries after duplicate hello', async () => {
    const f = fixture(name);
    f.forward.mockRejectedValue(new Error('private-token-payload'));
    try {
      f.host.sendHelloOnReady(hello);
      f.start();
      await drain();
      f.child.emit({ type: 'host:hello', ...hello });
      await drain();
      expect(f.node('state').textContent).toBe('Could not load: artifact unavailable');
      expect(f.forward).toHaveBeenCalledTimes(1);
    } finally {
      f.dispose();
    }
  });
  it('preserves renderer-specific null/empty behavior without changing context', async () => {
    const f = fixture(name);
    f.forward.mockResolvedValue(null);
    try {
      f.host.sendHelloOnReady(hello);
      f.start();
      await drain();
      if (name === 'overview')
        expect(f.node('state').textContent).toBe('Could not load: artifact unavailable');
      if (name === 'triage') expect(f.node('alerts-list').innerHTML).toContain('No alerts');
      if (name === 'artifact-builder') expect(f.node('recent-empty').hidden).toBe(false);
    } finally {
      f.dispose();
    }
  });
  it('does not accept unknown, malformed or duplicate response IDs', async () => {
    const f = fixture(name);
    let reply!: (value: unknown) => void;
    f.forward.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    try {
      f.host.sendHelloOnReady(hello);
      f.start();
      await drain();
      const request = f.parent.posted.find((frame) => frame.type === 'plugin:rpc-request')!;
      f.child.emit({ type: 'host:rpc-response', id: '__proto__', ok: true, payload: {} });
      f.child.emit({ type: 'host:rpc-response', id: request.id, ok: 'yes', payload: {} });
      await drain();
      expect(f.node('app').hidden).toBe(true);
      reply({ agentName: 'Current' });
      await drain();
      const original = f.node('name').textContent;
      f.child.emit({
        type: 'host:rpc-response',
        id: request.id,
        ok: true,
        payload: { agentName: 'Stale' },
      });
      await drain();
      expect(f.node('name').textContent).toBe(original);
      expect(f.forward).toHaveBeenCalledTimes(1);
    } finally {
      f.dispose();
    }
  });
  it('starts one fresh persisted lifetime and rejects same-tick old replies', async () => {
    const f = fixture(name);
    const replies: Array<(value: unknown) => void> = [];
    f.forward.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    f.context.Date = class extends Date {
      static now() {
        return 123456;
      }
    };
    try {
      f.host.sendHelloOnReady(hello);
      f.start();
      await drain();
      f.child.dispatch('pageshow', { persisted: false });
      await drain();
      expect(f.forward).toHaveBeenCalledTimes(1);
      f.child.dispatch('pagehide', { persisted: true });
      f.child.dispatch('pageshow', { persisted: true });
      f.child.dispatch('pageshow', { persisted: true });
      await drain();
      expect(f.forward).toHaveBeenCalledTimes(2);
      const ids = f.parent.posted
        .filter((frame) => frame.type === 'plugin:rpc-request')
        .map((frame) => frame.id);
      expect(new Set(ids).size).toBe(2);
      replies[0]!({ agentName: 'Old' });
      await drain();
      expect(f.node('app').hidden).toBe(true);
      replies[1]!({ agentName: 'New' });
      await drain();
      expect(f.node('app').hidden).toBe(false);
      expect(f.child.listeners.get('message')?.size).toBe(1);
    } finally {
      for (const reply of replies) reply({});
      f.dispose();
    }
  });
  it.each([true, false])(
    'fences a response already delivered before retirement (ok=%s)',
    async (ok) => {
      const f = fixture(name);
      f.forward.mockImplementation(() => new Promise(() => {}));
      try {
        f.host.sendHelloOnReady(hello);
        f.start();
        await drain();
        const request = f.parent.posted.find((frame) => frame.type === 'plugin:rpc-request')!;
        f.child.emit({
          type: 'host:rpc-response',
          id: request.id,
          ok,
          payload: { agentName: 'Obsolete' },
          error: { message: 'private-detail' },
        });
        f.child.dispatch('pagehide', { persisted: true });
        f.child.dispatch('pageshow', { persisted: true });
        await drain();
        expect(f.node('app').hidden).toBe(true);
        expect(f.node('state').textContent).toBe('Loading…');
        expect(f.forward).toHaveBeenCalledTimes(2);
      } finally {
        f.dispose();
      }
    },
  );
  it('fails safely when native entropy or outbound posting is unavailable', async () => {
    for (const failure of ['entropy', 'post']) {
      const f = fixture(name);
      try {
        if (failure === 'entropy') f.context.crypto = undefined;
        else
          vi.spyOn(f.parent, 'postMessage').mockImplementation(() => {
            throw new Error('secret-native-cause');
          });
        f.host.sendHelloOnReady(hello);
        f.start();
        await drain();
        expect(f.forward).not.toHaveBeenCalled();
        expect(f.node('state').textContent).toBe('Could not load: artifact unavailable');
      } finally {
        f.dispose();
        vi.restoreAllMocks();
      }
    }
  });
});

describe('generated artifact provenance', () => {
  it('preserves original render and helper bodies apart from the admitted overview TODO', () => {
    const expected = {
      overview: {
        render: '4241c69d3633b8fdf4a6d069c60cc0eb7778a7d1239269e1bcf40ef3a4e03958',
        fail: '48c2e2fa242d068c8b1d3246cd787ebb27a2ebe3db56e63d91510750d185ea88',
      },
      triage: {
        render: 'c4985d141d55c9f3e233036af31f89c6703ef637532370eed758df1d461b713f',
        fail: '48c2e2fa242d068c8b1d3246cd787ebb27a2ebe3db56e63d91510750d185ea88',
        esc: '66c1f336c93f12678436134c411b25c55851ed30b4733ee9ef033bb4f50d9a7f',
        relTime: '4ecf9502bc067de4200d04892128c5480c864abff958234d7436e550b5024c51',
      },
      'artifact-builder': {
        render: '8f2174fd64e3447425d2028f94f281d2aeb0c1582990757f9d263585062dc972',
        fail: '48c2e2fa242d068c8b1d3246cd787ebb27a2ebe3db56e63d91510750d185ea88',
        esc: '66c1f336c93f12678436134c411b25c55851ed30b4733ee9ef033bb4f50d9a7f',
        relTime: 'fb93be72912c9de9809ff79f8f9eb08cb16281dc064534e9cc040533ab96e283',
      },
    };
    for (const name of names) {
      const html = htmlFor(name).replace(
        /^        \/\/ TODO\(handoff\): Validate stats schema[^\n]*\n/m,
        '',
      );
      for (const [fn, hash] of Object.entries(expected[name])) {
        const match = html.match(
          new RegExp(`      function ${fn}\\([^\\n]*\\) \\{[\\s\\S]*?\\n      \\}`),
        );
        expect(match).not.toBeNull();
        expect(digest(match![0])).toBe(hash);
      }
    }
  });
  // TODO(handoff): the rebuild needs the sibling gateway checkout's built
  // `packages/plugin-ui-bridge/dist`, which hub CI does not have, so this case
  // only runs locally; `--check` mode still verifies the committed region and
  // provenance everywhere. See meta proposals/2026-09-08-platform-qc-remediation.md
  // (14-07 generated-bridge CI rebuild).
  it.runIf(existsSync(ENTRY))(
    'rebuilds identical real bytes twice and checks every actual embedded region and provenance',
    async () => {
      const first = await buildCandidate(),
        second = await buildCandidate();
      expect(first).toEqual(second);
      const notices = readFileSync(
        new URL('../../../../scripts/artifacts/inline-bridge-NOTICES.txt', import.meta.url),
        'utf8',
      );
      expect(first.region).toContain(notices.trimEnd());
      expect(first.provenance.inputs).toContainEqual({
        path: 'minion_hub/scripts/artifacts/inline-bridge-NOTICES.txt',
        sha256: digest(notices),
      });
      const htmls = names.map(htmlFor);
      const provenance = readFileSync(new URL('./bridge.provenance.json', import.meta.url), 'utf8');
      expect(() => checkArtifacts(htmls, provenance, first)).not.toThrow();
      const changed = [...htmls];
      changed[2] = changed[2]!.replace(START, `${START}\n/* drift */`);
      expect(() => checkArtifacts(changed, provenance, first)).toThrow('region differs');
      expect(() => checkArtifacts(htmls, provenance.replace('es2020', 'es2022'), first)).toThrow(
        'provenance differs',
      );
      expect(() =>
        checkArtifacts(htmls, provenance, {
          ...first,
          region: first.region + 'changed adapter output',
        }),
      ).toThrow('region differs');
    },
  );
  it('rejects altered input bytes and old installed candidate selection', async () => {
    expect(() => assertDigest('different', digest('approved'))).toThrow('input digest');
    await expect(
      buildCandidate({
        entry: fileURLToPath(
          new URL(
            '../../../../node_modules/@nikolasp98/plugin-ui-bridge/dist/index.js',
            import.meta.url,
          ),
        ),
      }),
    ).rejects.toThrow('qualified package entry');
  });
  it.each([
    'missing',
    `${START}a${START}b${END}`,
    `${END}a${START}`,
    `${START}a${END}b${END}`,
    `${START}outside${END}<script></script>`,
    `<script>${START}</script>${END}`,
  ])('rejects invalid delimiters %#', (html) => {
    expect(() => replaceRegion(html, `${START}ok${END}`)).toThrow();
  });
  it('rejects unexpected graph, assets, imports, executable bootstrap and closing-script output', () => {
    const good = {
      type: 'chunk',
      imports: [],
      dynamicImports: [],
      map: null,
      referencedFiles: [],
      modules: { '/approved/adapter': {}, '/approved/package': {} },
      code: 'var generatedPluginBridge = {};',
    };
    const allowed = Object.keys(good.modules);
    expect(validateOutput([good], allowed)).toBe(good.code);
    expect(() => validateOutput([good, { type: 'asset' }], allowed)).toThrow();
    expect(() =>
      validateOutput([{ ...good, modules: { ...good.modules, '/foreign/adapter': {} } }], allowed),
    ).toThrow('graph');
    for (const change of [
      { imports: ['x'] },
      { dynamicImports: ['x'] },
      { map: {} },
      { referencedFiles: ['style.css'] },
    ])
      expect(() => validateOutput([{ ...good, ...change }], allowed)).toThrow();
    for (const code of ['eval("x")', 'new Function("x")', 'fetch("x")', 'import("x")', '</ScRiPt>'])
      expect(() => validateOutput([{ ...good, code: good.code + code }], allowed)).toThrow();
  });
  it('rejects a changed helper source or an extra virtual helper', () => {
    const sources = ['/approved/adapter', '/approved/package'];
    const graph = new Map([
      ...sources.map((id) => [id, 'source'] as [string, string]),
      ...Object.entries(HELPERS),
    ]);
    expect(validateGraph(graph, sources)).toHaveLength(6);
    const altered = new Map(graph);
    altered.set(Object.keys(HELPERS)[0]!, digest('tampered'));
    expect(() => validateGraph(altered, sources)).toThrow('helper digest');
    const extra = new Map(graph);
    extra.set('\0@oxc-project+runtime@0.139.0/helpers/esm/extra.js', 'x');
    expect(() => validateGraph(extra, sources)).toThrow('module graph');
  });
  it('final adapter disposal removes document handlers and prevents persisted restart', () => {
    const f = fixture('overview');
    try {
      const html = htmlFor('overview');
      const region = html.slice(html.indexOf(START) + START.length, html.indexOf(END));
      runInContext(region, f.context, { timeout: 1000 });
      const api = f.context.generatedPluginBridge as {
        mount: (callbacks: { render: (value: unknown) => void; fail: (value: string) => void }) => {
          dispose: () => void;
        };
      };
      const handle = api.mount({ render: vi.fn(), fail: vi.fn() });
      handle.dispose();
      handle.dispose();
      expect(f.child.listeners.get('message')?.size ?? 0).toBe(0);
      expect(f.child.listeners.get('pagehide')?.size ?? 0).toBe(0);
      expect(f.child.listeners.get('pageshow')?.size ?? 0).toBe(0);
      const posted = f.parent.posted.length;
      f.child.dispatch('pageshow', { persisted: true });
      expect(f.parent.posted).toHaveLength(posted);
    } finally {
      f.dispose();
    }
  });
});
