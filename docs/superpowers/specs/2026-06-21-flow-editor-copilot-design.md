# Flow-editor copilot (design) — Phase 4

**Date:** 2026-06-21 · **Scope:** `minion_hub` — conversational editing of DB flows with a visual canvas diff.
Follow-up to the autonomous-agents UX upgrade (Phases 1–3). Hub-side only; no gateway changes.

## Context
- DB flows live in the `flows` table (`nodes`/`edges` JSON, `userId` creator, `tenantId` org, `active`). Edited at `/flow-editor/[id]` (`FlowCanvas.svelte` + `flowEditorState` runes store; saved via `PUT /api/flows/[id]`).
- Typed node data lives in `src/lib/state/features/flow-editor.svelte.ts` (`AgentNodeData`, `RouterNodeData`, `LLMNodeData`, …). Node `type` ∈ trigger | schedule | agent | llm | router | toolAgent | channel | handoff | reaction | transform | structured | pluginTrigger | …
- `FlowRunStatusLayer.svelte` already overlays per-node run status on the canvas — the diff overlay mirrors this pattern.
- The artifact-builder (`src/lib/server/artifacts/builder.ts`) is the precedent for a hub-side LLM via OpenRouter + AI SDK, env `OPENROUTER_API_KEY`.
- Master/code flows (`master-flows.ts`) are NOT editable — copilot targets DB flows only.

## Architecture
EDIT (admin/owner, from Phase 3) opens `/flow-editor/[id]` with a **copilot side panel**. The "flow-builder MCP" is an AI-SDK tool-pack inside a hub endpoint — no MCP transport, no gateway agent.

## Components

### 1. Flow ops reducers — `src/lib/flows/flow-ops.ts` (pure)
Operate on a working copy `{ nodes, edges }` (the editor's node/edge shape). Each returns a new copy; throws on invalid refs.
- `addNode(flow, { type, label, data?, position?, id? }) → { flow, nodeId }` — `id` optional, defaults to `${type}-${crypto.randomUUID().slice(0,8)}`; tests pass explicit ids for determinism.
- `connectNodes(flow, { source, target, sourceHandle?, targetHandle? }) → flow` (rejects unknown node ids; dedups identical edges)
- `updateNodeConfig(flow, { nodeId, data }) → flow` (shallow-merge into node.data; rejects unknown id)
- `setNodeLabel(flow, { nodeId, label }) → flow`
- `removeNode(flow, { nodeId }) → flow` (also drops incident edges)
- `removeEdge(flow, { edgeId }) → flow`
- `validateFlow(flow) → { ok: boolean; issues: string[] }` (≥1 trigger/schedule/pluginTrigger; no edge referencing a missing node; no node id collisions).
Node ids come from `addNode`'s optional `id` (above); the endpoint lets the default UUID apply, tests pass explicit ids.

### 2. Diff — `src/lib/flows/flow-diff.ts` (pure)
`diffFlow(current, proposed) → { nodes: Record<string,'added'|'removed'|'changed'>, edges: Record<string,'added'|'removed'> }`
- node added: id in proposed not current; removed: in current not proposed; changed: in both but `JSON.stringify(data)`/type/label differ.
- edge added/removed by id (or by `source→target(+handles)` key when ids differ).

### 3. Copilot endpoint — `src/routes/api/flows/[id]/copilot/+server.ts`
`POST` body `{ messages: { role:'user'|'assistant'; content:string }[] }`.
- Gate: `requireCoreCtx`; load flow row (org-scoped); allow if `locals.user.role === 'admin' || flow.userId === locals.user.id`, else `403`.
- Build the AI-SDK `tools` from §1 (each tool's `execute` applies the op to an in-memory working copy seeded from the flow). System prompt describes the node vocabulary + that it should make the smallest change satisfying the request, then call `validate`.
- `generateText({ model: openrouter(...), messages, tools, maxSteps: 8 })`. After the run, return `{ message: result.text, proposedFlow: workingCopy, validation: validateFlow(workingCopy) }`.
- Errors → `502` with message. No mutation of the DB here (proposal only).

### 4. Canvas diff overlay — modify `FlowCanvas.svelte`
- New optional prop `diff?: FlowDiff`. When set: each node gets a ring class by status (added → emerald, changed → amber, removed → red + `opacity-60 dashed`), edges likewise. Removed nodes/edges are rendered from a merged (current ∪ proposed) set so they remain visible as ghosts.
- When `diff` is null, behaves exactly as today.

### 5. Copilot side panel — `src/lib/components/flow-editor/FlowCopilotPanel.svelte`
- Docked right of the canvas in `/flow-editor/[id]` (admin/owner only — server passes `canCopilot`).
- Chat: message list (reuse `ChatMessage`/markdown), textarea, send. Calls the endpoint with the running `messages`; appends the assistant `message`.
- On a returned `proposedFlow`: store it as `pendingProposal`; the page computes `diffFlow(currentFlow, proposal)` and passes `diff` to `FlowCanvas`. A bar shows **Confirm · Reject · (keep typing to adjust)** + the validation summary.
  - **Confirm** → `PUT /api/flows/[id]` with proposed nodes/edges → set editor state to proposed → clear proposal/diff.
  - **Reject** → clear proposal/diff (editor unchanged).
  - **Adjust** → next send includes history; the endpoint re-derives from the *current saved* flow + full chat (so the model re-proposes), replacing the pending proposal.

### 6. Wiring
- `/flow-editor/[id]/+page.server.ts` (create if absent, else `+page.ts`): expose `canCopilot = isAdmin || flow.userId === user.id`. (If load is client-only today, gate via `page.data`/permissions already available.)
- Phase 3's EDIT button already targets `/flow-editor/[id]`; no change.

## Error handling
- Endpoint: gating 403; LLM failure 502; invalid tool args → the tool throws, AI SDK surfaces it as a tool error the model can retry within `maxSteps`.
- Confirm save failure → toast, keep the proposal so the user can retry.
- `validateFlow` issues are shown but do NOT block Confirm (user’s call) — surfaced as warnings.

## Out of scope (v1)
Streaming chat; editing master/code flows; multi-user concurrent edit locking; auto-apply. Add later if needed.

## Testing
- `flow-ops.ts`: unit each reducer (add/connect/updateConfig/remove/removeEdge/setLabel) + `validateFlow` (trigger-present, dangling-edge, id-collision). TDD.
- `flow-diff.ts`: unit added/removed/changed for nodes + edges.
- endpoint: gating (admin/owner allow, other 403) — unit with mocked db + a mocked `generateText` returning a fixed tool sequence.
- Manual: EDIT → panel → "add an LLM node after the trigger" → canvas shows green node + diff bar → Confirm persists; Reject reverts. `bun run check` 0/0/0.
