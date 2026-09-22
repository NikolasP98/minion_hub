# Hub action service

One Svelte 5 runtime in the root layout tracks navigation, table saves and finance
sync jobs. Context isolates server-rendered requests; signals update the global
activity UI. There is no global fetch interception or replacement event bus.

## Read actions

```ts
const readOptions = defineAction({
  id: 'example.options',
  policy: 'read',
  visibility: 'foreground',
  execute: async (input: string, { signal }) => loadOptions(input, signal),
});
const actions = useActions(); // during component initialization
const result = await actions.run(readOptions, 'input');
if (result.status === 'succeeded') applyOptions(result.value);
```

Definitions live in domain modules. IDs describe operations; never include URLs,
record IDs, user input or credentials. Pass the supplied AbortSignal to reads and
check the returned result before publishing data. `start` also returns a handle.
`get(handle.id)` exposes reactive immutable metadata. `subscribe` observes lifecycle
signals; observer exceptions cannot change the operation outcome.

## Commands and jobs

`defineCommandAction` declares a confirmed command; `runCommand(id, execute)` is
its adapter shorthand. Execution receives `signal`, `isCurrent()`, `acknowledge()`,
`attempt(id, work)`, `attachJob(jobId)` and `progress(completed, total)`.

Adapters return explicit outcomes: `succeeded`, `failed`, `conflict`, `unknown`,
`partial` or `committed-refreshing`. A resolved legacy `false` is failure. A lost
response can mean the server committed; never automatically replay an unknown
write. Acknowledgement followed by failed refresh retains the committed outcome.
Cancelling observation does not undo a mutation or cancel a durable server job.

| Adapter      | Behavior                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Navigation   | Tracks the early SvelteKit completion promise; hard unloads excluded                                                        |
| DataTable    | Retains optimistic drafts, serializes same-row snapshots, refreshes once per fill, preserves failed rows for explicit retry |
| Stock items  | Classifies PATCH responses through `saveRowPatch` and refreshes canonical data                                              |
| POS catalog  | Table edits and Active toggles share the same row queue                                                                     |
| Finance sync | Submission attaches an exact tenant-scoped job ID; persistent shell monitoring survives module navigation                   |

Use `runDraftCommand` for table adapters so rejected admission preserves unsent
drafts. Conflict and unknown rows require authoritative reload rather than blind
retry. Finance status discovery cannot prove an unknown submission succeeded merely
because another job exists. Its Check status action preserves this distinction.

## Activity and lifetime

Foreground work shows a shared nonblocking bar after 150 ms of continuous work.
Background reads remain silent; accepted jobs show a separate count. Known errors
can be dismissed; unknown and refresh-pending outcomes require adapter reconciliation.
Shared progress respects reduced motion. Progress updates are capped at 10 Hz with
immediate first/final values, and each action retains at most 32 attempt records.

The runtime bounds active actions and unresolved attention at 128, reserves two
navigation slots, and keeps at most 100 settled records for five minutes. Admission
can reject before execution: callers must preserve drafts and show actionable
feedback. Shared history contains status metadata, never request/result/error bodies.

Organization/user changes increment `scopeVersion`, abort read observations, clear
history and reset table controllers. Late completions cannot publish into the new
scope. Job monitoring cleanup never sends a server cancel request.

This is the first set of qualified adapters. Other queries, polling, event systems
and mutations retain their existing behavior until explicitly migrated. Client row
serialization does not provide cross-client version checks or backend idempotency.

Evaluation, inventory and rollout evidence are in minion-meta under
`audits/2026-09-21-hub-action-tracking/`; remaining centralization work is tracked in
`proposals/2026-09-20-hub-component-service-centralization.md`.
