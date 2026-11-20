/**
 * The house rules that have a gate, and only those (spec 138). A rule without a gate does not
 * belong here. Counts live in baseline.json and may only fall. Refresh after lowering a count:
 *   HOUSE_RULES_UPDATE=1 bunx vitest run scripts/house-rules/house-rules.test.ts
 */
import {
  countConfirm,
  countHand401,
  handbuiltErrorBody,
  importsDeprecatedModal,
  inlineModule403,
  kitInService,
  rawRequestJson,
  sendsRawWrite,
} from './scan.mjs';

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
    id: 'raw-request-json',
    sentence:
      'Write endpoints read their body through parseBody with a zod schema, not request.json().',
    entryPoint: 'parseBody from $server/api/validate',
    kind: 'count',
    exts: ['.ts'],
    exceptions: [],
    match: rawRequestJson,
  },
  {
    id: 'hand-401',
    sentence: 'Resolve the signed-in context through the shared helper, not a hand-written 401.',
    entryPoint: 'requireCoreCtx from $server/auth/core-ctx',
    kind: 'count',
    exts: ['.ts'],
    exceptions: [],
    match: (_file, text) => countHand401(text),
  },
  {
    id: 'handbuilt-error-body',
    sentence: 'Build error bodies with errorBody, not a hand-written json({ error ... }).',
    entryPoint: 'errorBody from $server/http/error-body',
    kind: 'count',
    exts: ['.ts'],
    exceptions: [],
    match: handbuiltErrorBody,
  },
  {
    id: 'kit-in-services',
    sentence: 'Services stay free of @sveltejs/kit; throw domain errors and map them in the route.',
    entryPoint: 'the route-level _errors.ts mappers',
    kind: 'count',
    exts: ['.ts'],
    exceptions: [],
    match: kitInService,
  },
  {
    id: 'inline-module-403',
    sentence:
      'A switched-off module answers 404 through requireModuleEnabled, never an inline 403.',
    entryPoint: 'requireModuleEnabled from $server/http/require-module',
    kind: 'count',
    exts: ['.ts'],
    exceptions: [],
    match: inlineModule403,
  },
  {
    id: 'tick-routes-listed',
    sentence: 'Every src/routes/api/**/tick route has a row in SYSTEM_AUTOMATIONS.',
    entryPoint: 'src/lib/automations/system-automations.ts',
    kind: 'structural',
    exceptions: [],
  },
];
