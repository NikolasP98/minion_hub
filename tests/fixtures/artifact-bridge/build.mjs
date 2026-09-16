import { build } from 'vite';
import { mkdir, readFile, writeFile, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Local trusted-source browser fixture only. No application server or customer data.
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.argv[2];
if (!output || !/^\/tmp\/minion-14-07-browser-[a-zA-Z0-9_-]+$/.test(output))
  throw new Error('An explicitly admitted private output directory is required');
if ((await realpath(output)) !== output) throw new Error('Output link is not admitted');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry = path.resolve(hub, '../minion/packages/plugin-ui-bridge/dist/index.js');
if (
  hash(await readFile(entry)) !== '4f7bd0418fdf85d8a3206cab1c9f3db767de7dc5745a93fbb73b6ab110a098d6'
)
  throw new Error('Unreviewed plugin bridge entry');
const host = path.join(hub, 'src/lib/plugins/bridge-host.ts');
const virtual = path.join(output, 'fixture-entry.js');
const source = `
import { mountHostBridge } from ${JSON.stringify(host)};
import { HostBridge } from ${JSON.stringify(path.join(hub, 'src/lib/plugins/bridge-protocol.ts'))};
const events = [], calls = [], pending = [];
let mounted, frame, serial = 0;
window.addEventListener('message', event => {
  events.push({ origin:event.origin, current:event.source===frame?.contentWindow,
    type:event.data?.type, id:event.data?.id });
});
window.addEventListener('pageshow', event => events.push({type:'parent:pageshow',persisted:event.persisted}));
window.addEventListener('pagehide', event => events.push({type:'parent:pagehide',persisted:event.persisted}));
const hello = {theme:'light',tokens:{'--radius':'8px'},gatewayUrl:'',authToken:'',locale:'en'};
const context = {
  agentName:'Synthetic Agent',agentRole:'Fixture',agentDescription:'Local protocol verification',
  status:{state:'ready',detail:'Synthetic context',stats:{sent:3,failed:0,skipped:1}},trigger:'manual',
  data:{counts:{total:5,high:2,med:2,low:1,notified:2,responded:1},recent:[]},
  vars:{'artifacts.builtCount':3,'artifacts.recent':[]}
};
window.qc = {
  load(name, mode='pending') {
    if (!['overview','triage','artifact-builder'].includes(name)) throw Error('Unknown fixture');
    mounted?.dispose(); frame?.remove();
    const lifetime = ++serial;
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox','allow-scripts');
    frame.title = name;
    document.querySelector('main').append(frame);
    const options = { self:window,target:frame.contentWindow,pluginOrigin:location.origin,
      sandboxed:true,hello,forwardRpc(method,params) {
        if (method!=='hub.artifact.context.get') return Promise.reject(Error('Unlisted fixture method'));
        calls.push({lifetime,method,params});
        return new Promise((resolve,reject)=>pending.push({lifetime,resolve,reject}));
      }};
    if (mode==='ready-only') {
      const bridge = new HostBridge(options);
      mounted={bridge,dispose:()=>bridge.dispose(),sendThemeChange:(theme,tokens)=>bridge.sendThemeChange({theme,tokens})};
    } else mounted = mountHostBridge(options);
    frame.src = '/'+name+'/index.html#hostOrigin='+encodeURIComponent(location.origin);
    document.querySelector('output').textContent = name+' / '+mode;
    return lifetime;
  },
  settle(lifetime, fail=false) {
    for (let index=pending.length-1; index>=0; index--) {
      if (pending[index].lifetime!==lifetime) continue;
      const [item]=pending.splice(index,1);
      fail ? item.reject(Error('PRIVATE_FIXTURE_ERROR')) : item.resolve(context);
    }
  },
  settleFirst(lifetime, label) {
    const index=pending.findIndex(item=>item.lifetime===lifetime);
    if(index<0) throw Error("No pending fixture item");
    const [item]=pending.splice(index,1);item.resolve({...context,agentName:label});
  },
  rawHello(version=1) {
    const message = {type:'host:hello',...hello};
    if (version!=='legacy') message.protocolVersion=version;
    frame.contentWindow.postMessage(message,'*');
  },
  theme() { mounted.sendThemeChange('dark',{'--radius':'11px'}); },
  sibling() {
    const sibling=document.createElement('iframe'); sibling.hidden=true;
    sibling.setAttribute('sandbox','allow-scripts');
    sibling.srcdoc='<script>parent.postMessage({type:"plugin:rpc-request",id:"sibling-forgery",method:"hub.artifact.context.get",params:{}},"*")<\\/script>';
    document.body.append(sibling);
  },
  snapshot() { return {events,calls,serial,pending:pending.map(x=>x.lifetime)}; },
  dispose() { mounted?.dispose(); frame?.remove(); frame=null; }
};
`;
await writeFile(virtual, source);
const result = await build({
  root: hub,
  configFile: false,
  envDir: false,
  envFile: false,
  logLevel: 'silent',
  resolve: { alias: [{ find: /^@nikolasp98\/plugin-ui-bridge$/, replacement: entry }] },
  build: {
    write: false,
    target: 'es2020',
    minify: false,
    sourcemap: false,
    lib: { entry: virtual, formats: ['iife'], name: 'NativeArtifactFixture' },
  },
});
const bundle = Array.isArray(result) && result.length === 1 ? result[0] : result;
if (!bundle || !('output' in bundle) || bundle.output.length !== 1)
  throw new Error('Expected one in-memory fixture script');
const script = bundle.output[0];
if (script.type !== 'chunk' || script.imports.length || script.dynamicImports.length)
  throw new Error('Fixture must have no external runtime imports');
await writeFile(path.join(output, 'fixture.js'), script.code);
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minion artifact native fixture</title><style>body{margin:0}output{display:block;padding:8px;font:14px system-ui}iframe{display:block;border:0;width:100%;height:calc(100vh - 40px)}main{min-width:0}</style><output>Synthetic protocol fixture</output><main></main><script src="/fixture.js"></script>`,
);
await writeFile(
  path.join(output, 'away.html'),
  '<!doctype html><title>Local navigation fixture</title><p>Local navigation fixture</p>',
);
const manifest = {};
for (const name of ['overview', 'triage', 'artifact-builder']) {
  const src = path.join(hub, 'src/lib/artifacts/builtin', name, 'index.html');
  await mkdir(path.join(output, name), { recursive: true });
  await copyFile(src, path.join(output, name, 'index.html'));
  manifest[name] = hash(await readFile(src));
}
manifest.fixture = hash(script.code);
manifest.host = hash(await readFile(host));
manifest.protocol = hash(await readFile(path.join(hub, 'src/lib/plugins/bridge-protocol.ts')));
manifest.package = hash(await readFile(entry));
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, manifest }));
