import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-navigation-'));
const out = path.resolve(process.env.MINION_NAV_FIXTURE_OUT ?? path.join(work, 'bundle'));
if (fs.existsSync(out)) throw new Error('Navigation fixture output must not exist');
const { build } = await import('vite');
const { svelte } = await import('@sveltejs/vite-plugin-svelte');
const { default: tailwindcss } = await import('@tailwindcss/vite');
const write = (name, content) => {
  const target = path.join(work, name);
  fs.writeFileSync(target, content);
  return target;
};
const state = write(
  'page.svelte.js',
  `
const persona = new URL(location.href).searchParams.get('persona') ?? 'admin';
export const page = $state({url:new URL('/home',location.origin),params:{},route:{id:'/(app)/home'},state:{},data:{
 user:{id:'fixture-user',email:'fixture@example.test',displayName:'Fixture',role:persona==='admin'?'admin':'user'},
 activeOrgKind:persona==='personal'?'personal':'business', activeOrgId:'fixture-org', organizations:[], hosts:[], workspaces:[],
 permissions:{permissions:persona==='restricted'?[]:['crm:view','finances:view','monitor:view','agents:view','marketplace:view','reliability:view','workspace:view']},
 preferences:{preferences:{navOrder:{sections:['agents','organization'],items:{agents:['/agents/workshop','/agents/autonomous']}}}},
}});
export const navigating=null; export const updated={current:false,check:async()=>false};
`,
);
const user = write(
  'user.js',
  `import {page} from ${JSON.stringify(state)};
export const userState={get user(){return page.data.user},get role(){return page.data.user.role},get orgId(){return 'fixture-org'},get allowedAgentIds(){return null}};
export const isAdmin={get value(){return page.data.user.role==='admin'}};
export const logout=()=>{window.dispatchEvent(new CustomEvent('fixture-logout'))};
export const getUserInitials=()=> 'FX';
${['invalidateUser', 'invalidatePermissions', 'invalidateWorkspaces', 'invalidateHosts', 'invalidatePreferences', 'invalidatePersonalAgent'].map((n) => `export const ${n}=async()=>{};`).join('\n')}
`,
);
const notifications = write(
  'notifications.js',
  `export const notifications={badgeCount:0,hasPending:false,pendingCount:0}; export const subscribeNotificationsPolling=()=>()=>{}; export const refreshNotifications=async()=>{};`,
);
const finance = write(
  'finance.js',
  `export const financeSync={active:false,total:null,processed:0,percent:0,error:null,status:null,refresh:async()=>{}};`,
);
const environment = write(
  'environment.js',
  `export const browser=true;export const building=false;export const dev=false;export const version='fixture';`,
);
const env = write('env.js', `export const env={};export const PUBLIC_GATEWAY_URL='';`);
const navigation = write(
  'navigation.js',
  [
    'goto',
    'invalidate',
    'invalidateAll',
    'preloadData',
    'preloadCode',
    'beforeNavigate',
    'afterNavigate',
    'onNavigate',
    'pushState',
    'replaceState',
    'disableScrollHandling',
  ]
    .map((n) => `export const ${n}=()=>{};`)
    .join('\n'),
);
const stores = write(
  'stores.js',
  `import {readable} from 'svelte/store';import {page as state} from ${JSON.stringify(state)};export const page=readable(state);export const navigating=readable(null);export const updated=readable(false);`,
);
const entry = write(
  'entry.js',
  `import {mount} from 'svelte';import ${JSON.stringify(root + 'src/app.css')};import Fixture from ${JSON.stringify(fixture + 'Fixture.svelte')};mount(Fixture,{target:document.getElementById('app')});`,
);
console.log(JSON.stringify({ work, out }));
await build({
  root,
  configFile: false,
  envDir: false,
  cacheDir: path.join(work, 'cache'),
  plugins: [tailwindcss(), svelte({ configFile: false })],
  define: { __APP_VERSION__: JSON.stringify('navigation-fixture') },
  resolve: {
    dedupe: ['svelte'],
    alias: {
      '$app/state': state,
      '$app/stores': stores,
      '$app/navigation': navigation,
      '$app/environment': environment,
      '$env/dynamic/public': env,
      '$env/static/public': env,
      '$lib/state/features/user.svelte': user,
      '$lib/state/features/notifications.svelte': notifications,
      '$lib/state/features/finance-sync.svelte': finance,
      $lib: root + 'src/lib',
    },
  },
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: entry,
      output: { entryFileNames: 'entry.js', assetFileNames: '[name][extname]' },
    },
  },
});
const css = fs
  .readdirSync(out)
  .filter((n) => n.endsWith('.css'))
  .map((n) => `<link rel="stylesheet" href="/${n}">`)
  .join('');
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Navigation parity fixture</title></head><body style="margin:0"><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const fonts = [];
for (const match of fs
  .readFileSync(root + 'src/app.css', 'utf8')
  .matchAll(/\/fonts\/([^)'"\s]+)/g)) {
  const name = match[1];
  if (fonts.some((f) => f.name === name)) continue;
  const bytes = fs.readFileSync(root + 'static/fonts/' + name);
  fs.writeFileSync(path.join(out, 'fonts', name), bytes);
  fonts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
}
fs.writeFileSync(path.join(out, 'fixture-manifest.json'), JSON.stringify({ work, fonts }, null, 2));
