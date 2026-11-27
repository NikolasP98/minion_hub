/**
 * The house rules that have a gate, and only those (spec 138). A rule without a gate does not
 * belong here. Counts live in baseline.json and may only fall. Refresh after lowering a count:
 *   HOUSE_RULES_UPDATE=1 bunx vitest run scripts/house-rules/house-rules.test.ts
 */
import { countConfirm, importsDeprecatedModal, sendsRawWrite } from './scan.mjs';

export const RULES = [
  {
    id: 'native-confirm',
    sentence: 'Ask for confirmation with the shared confirm dialog, never the browser confirm().',
    entryPoint: 'ConfirmDialog from $lib/components/ui/foundations',
    kind: 'count',
    exts: ['.svelte', '.ts'],
    exceptions: [
      {
        path: 'src/routes/book/[slug]/+page.svelte',
        reason: 'defines its own local function named confirm',
      },
    ],
    match: (_file, text) => countConfirm(text),
  },
  {
    id: 'deprecated-modal',
    sentence: 'Do not import the deprecated Modal component.',
    entryPoint: 'Dialog, ConfirmDialog or Sheet from $lib/components/ui/foundations',
    kind: 'count',
    exts: ['.svelte', '.ts'],
    exceptions: [],
    match: importsDeprecatedModal,
  },
  {
    id: 'raw-write-fetch',
    sentence: 'Send writes from components through fetchJson, not a raw fetch with a write method.',
    entryPoint: 'src/lib/api/fetch-json.ts',
    kind: 'count',
    exts: ['.svelte'],
    exceptions: [],
    match: (_file, text) => sendsRawWrite(text),
  },
  {
    id: 'tick-routes-listed',
    sentence: 'Every src/routes/api/**/tick route has a row in SYSTEM_AUTOMATIONS.',
    entryPoint: 'src/lib/automations/system-automations.ts',
    kind: 'structural',
    exceptions: [],
  },
];
