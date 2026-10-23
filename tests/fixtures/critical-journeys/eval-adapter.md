# Disposable assistant adapter v1

Launch from this Hub checkout:

```sh
node tests/fixtures/critical-journeys/eval-adapter.mjs --stdio
```

This is a test artifact. `hello` compiles fresh current source and the actual classifier parser, starts a run-owned loopback server on an allocated port and starts a private headless browser. It never reads provider credentials. Diagnostic/build output stays in the returned private evidence directory. `close` and stdin EOF dispose owned runtime resources. The adapter never reuses an earlier build.

Every line is `{version:1,id,type,payload}`; successful replies use `type:result`, failures `type:error`. `hello` must precede `reset`. Command IDs are limited to 2,048; repeated identical bytes return the prior result, conflicting bytes reject. Each line is limited to 64 KiB. The validator is exported from `eval-adapter.mjs` and covered by its adjacent Node test.

`hello` accepts `protocol` and optional `sourceHash`, `lockHash`, `adapterHash` pins. It returns `protocol`, base `sourceSha`, exact content `sourceHash`, `lockHash`, `buildHash`, `adapterHash`, the hashed source inventory, disposable marker, supported features and private `evidenceRoot`. A dirty source content hash is intermediate evidence; release qualification must additionally pin the reviewed source commit. The build hash binds fresh browser files and the separately built actual classifier parser.

`reset` accepts the fields declared in `eval-protocol.ts`: `episodeId`, `arm` (`full|jev|core_discovery`), integer `seed`, `persona` (`owner|reader`), `initialState` (`empty|one-element`), optional expected `initialStateHash`, `locale` (`en|es`), optional `surface` (`home|floating`), `sandbox`, bounded hash `revisions`, `allowedTools`, and required `model:{requestedModel,boundDescriptor}`. Reset creates a fresh browser context with empty storage and returns the independently computed initial state hash. Use the returned hash as the expected hash for subsequent arms. Persona and state catalogs are fixed, disposable fixtures; they certify no production identity.

`turn` accepts `text` and optional `origin:user`. It fills and submits the actual mounted composer. Actual classifier and gateway requests emerge as unsolicited `provider_request` records, with a unique `requestId` in both frame ID and payload. Main requests retain the actual current `chat.send` envelope as `message`. `messages` projects the fixture gateway's canonical history for that exact session, followed by the current composed user turn exactly once. The production block normalizer preserves text/context bytes and serializes actual presentation-tool inputs; history compaction replaces the same canonical history read by the provider. Serialized history grants no UI authority. Requests also retain run/session and the reset-pinned model descriptor. Classifier requests contain the actual model, state and questions built by `assistant-router.service.ts`.

`provider_result` accepts `requestId`, raw provider `result`, optional bounded `error` (`timeout|transport|invalid`), ack control (`before|after|missing`), `duplicateFinal`, and provider receipt fields `requestedModel`, nullable `resolvedModel`, `usage:{inputTokens,outputTokens,costUsd,costStatus}`. Classifier results pass through the actual parser before reaching the browser's routing client. Main results accept `text`, `choices[0].message.content`, or `message:{role:assistant,content:[...]}`. The typed message branch accepts at most eight text or `toolCall` blocks; the only presentation tool name is `chat_artifact`. Artifact arguments remain raw input for the actual production `ChatBlocks` parser. These messages enter the ordinary synthetic WebSocket final handler. Missing provider receipt fields remain missing coverage; they are never converted to a known zero bill.

`transition` accepts one typed action from `eval-protocol.ts`: owner, page, session, held reload/release (including failure), unqualified window reload, duplicate final, unrelated registry revision, history reload/compaction, or exact visible choice/artifact button index. It cannot supply JavaScript, shell commands, arbitrary selectors/URLs or an invocation capability. The trusted handoff is generated only by the actual mounted sandbox tool → host reload → stable page lease.

`cancel` invokes the mounted Stop control and retires pending inference admission. `collect` returns production client observations, actual HTTP operations, independent disposable mutation receipts with before/after hashes, inference receipts, final state hash and network boundary evidence. Pending UI runs, reloads, providers, unknown provider receipts or violations mark collection incomplete. `answerTexts` comes from the actual committed chat store; `renderedAnswers` comes from visible actual Markdown components. The adapter never uses the provider return directly as terminal-answer evidence. Client task-terminal observations do not establish durable domain success.

`close` preserves evidence and disposes this adapter's server/browser/context. The same run must not be reported complete after a dead child, rejected handshake or missing evidence.

Validation:

```sh
node --test tests/fixtures/critical-journeys/eval-adapter.test.mjs
```

The installed critical matrix also uses bounded fixture-only observation and transport controls for known-run cancellation state, held history, failed acknowledgements and unknown/retired final frames. These methods live only in the disposable browser fixture. They are absent from the stdio command set and cannot supply a private invocation capability. Mutation receipts still come only from the disposable store after the actual tool HTTP request.

The allocated integration lane also runs
`PLAYWRIGHT_BROWSERS_PATH=<installed-browser-cache> node --test tests/fixtures/critical-journeys/eval-history.integration.test.mjs`.
It launches a fresh real stdio adapter, submits three synthetic user turns, and asserts
provider-visible two-turn history, canonical compaction, exact current-turn inclusion,
clean collection and zero external requests. It compiles source and must not run alongside
another heavy qualification job. The default installed CJA2 journey asserts the same
provider history through the actual mounted fixture, including sandbox-result continuation.
