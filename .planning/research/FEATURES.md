# Feature Research

**Domain:** Visual AI Workflow/Skill Builder Improvements
**Researched:** 2026-03-18
**Confidence:** MEDIUM-HIGH (ecosystem patterns verified across multiple tools; specific UX behaviors confirmed via docs/issues where possible)

---

## Scope

This research covers five specific improvement areas for the Minion Hub skill builder v2.0:

1. Validation error display and fix-navigation
2. Versioning with snapshots and rollback
3. AI generation cost/usage display
4. Staged import previews
5. Data flow edge labeling

**Existing baseline (already shipped):** AI skill generation via tool calling, DAG chapter editor (SvelteFlow), server-side publish validation, chapter editor with tool assignment, 9-tool manifest.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any mature workflow builder. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Publish blocked when validation errors exist | Every workflow builder (n8n, Dify, HighLevel) disables or warns on publish with unresolved errors. Users expect "can't publish broken skill." | LOW | Already partially implemented (publishError state) but needs disabled button + pre-check client-side |
| Inline error indicators on canvas nodes | HighLevel shows warning icons on broken nodes on the canvas. n8n highlights nodes with missing required fields. Users expect to see at a glance which chapters are broken. | LOW | SvelteFlow supports custom node classes — add a red ring/badge to ChapterDAG nodes with errors |
| Clickable error list with jump-to-node | HighLevel, Visual Studio Workflow Designer, n8n: clicking an error in the error list navigates to and selects the broken node on canvas. Required for large DAGs. | MEDIUM | Requires error list panel + SvelteFlow `fitView` / `setCenter` to the offending node |
| Structured error messages, not generic strings | n8n shipped "Validation Failed" generics for years; GitHub issue #10074 documented user frustration. Competitors all moved to structured errors (node name + field + reason). | LOW | Replace `publishError = data.errors.join('; ')` with a structured error array typed by chapter |
| Save / auto-save that does NOT change publish status | n8n 2.0 explicitly separated Save from Publish after user confusion. Users expect saving a draft does not affect the live/published version. | LOW | Already architecturally correct (draft/published status). Reinforce in UI copy. |
| Token/cost display after AI generation | Vellum (March 2025) ships cost column per execution. n8n has token metrics workflow template. Langfuse tracks per-generation. Users who pay per token expect to see what was spent. | MEDIUM | Capture `usage` from Anthropic response, store in DB, show in generation result UI |
| Version history (at least linear) | n8n Cloud/Enterprise ships workflow history with Save/Publish distinction. Dify ships full version control panel. Flowise and Langflow have open GitHub issues requesting it — absence is a known gap that frustrates users. | HIGH | Requires schema: `skill_versions` table with snapshot JSON + metadata |

### Differentiators (Competitive Advantage)

Features that go beyond table stakes and would meaningfully distinguish the builder.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Staged AI import preview (accept/reject) | No current competitor in the low-code AI space ships a diff-preview for AI-generated skills before they replace the canvas. Users can inspect what the AI wants to create and reject individual chapters. Reduces the "AI overwrote my work" fear. | MEDIUM | Show a modal with proposed chapters/edges before committing any DB writes. Cancel = no-op. Accept = current create flow. |
| Named version snapshots with changelog | Dify allows custom version names + release notes on publish. n8n only has timestamped auto-saves. Named snapshots ("Added retry chapter", "Before refactor") dramatically improve navigability. | MEDIUM | Extend version schema: `label TEXT`, `changelog TEXT`. UI: name input on publish action. |
| Per-node cost attribution in generation | Vellum (April 2025) shows cost per subworkflow node after a run. For skills with multiple AI-assisted chapter generations, showing "this chapter cost $0.003" helps users understand where budget goes. | HIGH | Requires per-chapter generation tracking, not just per-skill. Each `suggest-chapter` call should store its own usage record. |
| Edge data-type labels (variable passing hints) | Dify's variable system shows what flows between nodes via a variable pool. SvelteFlow `EdgeLabelRenderer` can show compact type badges on edges (e.g., "text", "result", "condition"). Competitors that lack this force users to mentally track data flow. | MEDIUM | Use SvelteFlow `<EdgeLabelRenderer>` to render the existing `edge.label` field as a badge. Low effort since edge labels already exist in schema. |
| Upstream data preview (what flows into a chapter) | Shows the output definition of a chapter's upstream dependencies when editing it. Reduces context-switching between chapter editor modal and the DAG canvas. | MEDIUM | When `ChapterEditor` opens, fetch the `outputDef` of all upstream chapters and display them in a collapsible panel |
| Rollback to any named version in one click | Dify requires "Restore → loads into draft → republish." A single-click rollback that atomically replaces the live skill is faster. Appropriate for self-hosted single-user context. | MEDIUM | `POST /api/builder/skills/[id]/versions/[versionId]/restore` that replaces current chapters/edges with snapshot JSON |
| Budget cap / generation abort | Dify and n8n both lack pre-flight cost caps on AI generation. Adding a `maxGenerationCostCents` config that blocks generation when estimated cost would exceed budget is novel for this category. | HIGH | Requires cost estimation before generation (token count estimate from prompt length). Approximate only. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time collaborative editing | Teams want to co-edit skills simultaneously | Single-user self-hosted context; adds websocket locking complexity with no benefit; conflicts with auto-save debounce | Last-write-wins auto-save is fine. Git-based version history is the collaboration story. |
| Full diff view between versions | Looks useful for comparing snapshots | DAG JSON diffs are unreadable without a visual render; comparing two rendered DAGs side by side is a major UI surface | Named changelogs (what changed) + ability to restore are sufficient. Diff-render is v3+ work. |
| Runtime dry-run from the builder | Users want "test my skill without deploying" | Requires gateway skill runtime (Phase 8 is blocked — gateway-side, not hub-side). Building a mock runner in the hub creates a divergent execution model. | Flag as blocked in UI with "Coming when runtime ships." Per-node test status deferred to same phase. |
| AI cost predictions before generation | Seems useful for budget control | Token count estimation from prompt text is inherently unreliable (varies 2–5x by model and completion). Showing a number creates false confidence. | Show actual cost after generation (post-hoc tracking). Budget cap by hard limit, not by prediction. |
| Undo/redo on canvas | Expected from design tools like Figma | SvelteFlow does not ship undo/redo. Implementing it requires full command-pattern state management on top of Svelte 5 runes — high complexity. | Version snapshots (save before destructive AI generation) serve the same recovery need. |

---

## Feature Dependencies

```
Validation Error Panel
    └──requires──> Structured validation errors from API (already shipped server-side)
    └──requires──> Client-side pre-publish validation (runs same rules before API call)
    └──enhances──> Inline canvas node error indicators (share same error set)

Clickable error navigation
    └──requires──> Validation Error Panel
    └──requires──> SvelteFlow programmatic viewport control (fitView/setCenter)

Version History
    └──requires──> skill_versions DB schema (new table)
    └──requires──> Version snapshot service (builder.service.ts)
    └──requires──> Version API routes (GET list, POST create, POST restore)
    └──enhances──> Staged AI import preview (can snapshot before AI overwrites)

Named Version Snapshots
    └──requires──> Version History (base feature)

Staged AI Import Preview
    └──requires──> AI generation already produces structured chapter/edge data (already true)
    └──enhances──> Version History (auto-snapshot before accepting AI generation)

Cost Display (post-generation)
    └──requires──> Anthropic usage extraction (add to suggest-skill + suggest-chapter routes)
    └──requires──> DB field for token usage on skill/generation record

Per-chapter cost attribution
    └──requires──> Cost Display (base)
    └──requires──> Per-chapter generation tracking (not just per-skill)

Edge data-type labels
    └──requires──> Edge label field already in DB schema (already true — `label TEXT`)
    └──independent──> no other features required

Upstream data preview in ChapterEditor
    └──requires──> Edge data loaded in ChapterEditor context (currently not passed in)
```

### Dependency Notes

- **Staged AI import preview requires no new DB schema** if implemented as a client-side review modal before any API calls fire. This makes it the easiest differentiator to ship.
- **Version history blocks named snapshots** — the schema must come first. But named snapshots can be added to the same migration.
- **Edge labels are already in the DB schema** (`label TEXT` in `chapterEdges`). The only work is rendering them in the SvelteFlow `<EdgeLabelRenderer>`.
- **Cost display is independent** of versioning and validation — it only needs API changes to extract and return `usage` from the Anthropic response.

---

## MVP Definition (for this milestone)

This is a subsequent milestone improving an existing shipped product. The MVP framing applies to which improvements ship first vs. later.

### Ship First (Phase Priority)

- [ ] Structured validation error panel with chapter-level errors — _users currently see a joined string; this is actively broken UX_
- [ ] Publish button disabled client-side when validation errors detected — _table stakes, low effort_
- [ ] Inline canvas node error indicators (red badge on broken chapters) — _table stakes, low effort_
- [ ] Clickable error → jump to canvas node — _expected by any workflow builder user_
- [ ] Token/cost display after AI generation — _every call currently silently discards usage data_
- [ ] Edge label rendering in ChapterDAG — _schema already supports it, UI doesn't render it_

### Add Next (After Core Quality)

- [ ] Version history schema + linear snapshot list — _triggers when users start losing work to AI overwrites or manual mistakes_
- [ ] Named version snapshots with changelog on publish — _small delta on top of linear history_
- [ ] Staged AI import preview modal — _differentiator, prevents "AI overwrote my work" frustration_
- [ ] Upstream data preview inside ChapterEditor — _polish; reduces context switching_

### Defer (v3+)

- [ ] Per-chapter cost attribution — _requires per-call tracking infrastructure; v3 observability work_
- [ ] Budget cap / generation abort — _high complexity, approximate only; defer until cost tracking is mature_
- [ ] Rollback in one click (atomic) — _nice to have on top of restore-to-draft; minor workflow improvement_

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Structured error panel + disabled publish | HIGH | LOW | P1 |
| Inline canvas node error indicators | HIGH | LOW | P1 |
| Jump-to-node from error list | HIGH | MEDIUM | P1 |
| Token/cost display after AI generation | MEDIUM | LOW | P1 |
| Edge label rendering in DAG | MEDIUM | LOW | P1 |
| Version history (linear) | HIGH | HIGH | P2 |
| Named version snapshots | MEDIUM | MEDIUM | P2 |
| Staged AI import preview | HIGH | MEDIUM | P2 |
| Upstream data preview in ChapterEditor | MEDIUM | MEDIUM | P2 |
| Per-chapter cost attribution | LOW | HIGH | P3 |
| Budget cap / generation abort | LOW | HIGH | P3 |
| Full visual diff between versions | LOW | VERY HIGH | P3 |

**Priority key:**
- P1: Must have for v2.0 — addresses known broken UX or table stakes gaps
- P2: Should have for v2.0 — differentiators and polish
- P3: Future consideration — v3.0 scope

---

## Competitor Feature Analysis

| Feature | n8n | Dify | HighLevel | Langflow/Flowise | Our Approach |
|---------|-----|------|-----------|-----------------|--------------|
| Validation error display | Generic "Validation Failed" toast (long-standing UX issue, GitHub #10074) | Node-level inline validation before publish | Dedicated error panel with categories, node icon badges, jump-to-node | No publish validation (errors discovered at runtime) | Structured error array per chapter, sidebar panel, SvelteFlow node badges |
| Jump to broken node | No (manual scan) | Unclear from docs | Yes — click error to open node sidebar | No | Yes — `fitView` to offending chapter node |
| Version history | Cloud/Enterprise only — auto-saved snapshots, Save vs Publish distinction | Full version control panel: named versions, changelog, filter by author, restore-to-draft | Not researched | Requested in GitHub issues, not yet shipped (Langflow #8634, Flowise #2882) | Schema-first: `skill_versions` table, named snapshots on publish |
| Rollback | Select version → "Publish this version" | Restore to draft → re-publish | Not researched | Not available | Restore-to-draft first; atomic rollback as enhancement |
| AI generation cost display | Separate metrics workflow template (not inline) | Not in builder UI | Not applicable | Not available | Inline: show `promptTokens + completionTokens + estimatedCost` in generation result toast |
| Import/staged preview | Summary of nodes + conflict warnings on JSON import | Not researched | Not applicable | JSON import replaces current flow immediately | Modal diff: show proposed chapters before committing any DB writes |
| Edge labels / data flow | No edge labels in canvas | Variable names shown in node connections via variable pool UI | Not applicable | Edges unlabeled | Render existing `label` field via SvelteFlow EdgeLabelRenderer |

---

## Sources

- [n8n Workflow History Docs](https://docs.n8n.io/workflows/history/) — confirms Save vs Publish distinction, Cloud/Enterprise gating
- [n8n Validation Issue #10074](https://github.com/n8n-io/n8n/issues/10074) — confirms generic error message UX gap; NODE-1525 tracking ticket closed without fix
- [Dify Version Control (legacy docs)](https://legacy-docs.dify.ai/guides/management/version-control) — confirmed: named versions, release notes, publisher filter, restore-to-draft, "Latest" cannot be deleted
- [Dify Error Handling Docs](https://legacy-docs.dify.ai/guides/workflow/error-handling) — node-level error handling strategies
- [HighLevel Workflow Error Highlighting](https://help.gohighlevel.com/support/solutions/articles/155000004872-highlighting-resolving-errors-in-a-workflow) — confirmed: error side panel, node icon badges, click-to-navigate, AI-assisted resolution
- [Langflow Version History Issue #8634](https://github.com/langflow-ai/langflow/issues/8634) — confirms Langflow lacks versioning; feature is requested
- [Flowise Versioning Issue #2882](https://github.com/FlowiseAI/Flowise/issues/2882) — confirms Flowise lacks versioning
- [Vellum AI cost tracking (March 2025)](https://docs.vellum.ai/changelog/2025/2025-03) — confirmed: cost column per workflow execution, subworkflow cost display added April 2025
- [Langfuse token/cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — confirmed: per-generation cost tracking, pricing tiers for Anthropic Claude
- [ShapeOfAI UX Patterns](https://www.shapeof.ai/patterns/workflow) — workflow UX: show projected token usage at step level for AI-proposed flows
- [n8n 2.0 Version Control (community)](https://n8n-template.com/n8n-2-0-version-control-publish-vs-save-workflow-history/) — Save vs Publish distinction introduced in n8n 2.0
- [Microsoft Visual Studio Workflow Designer error messages](https://learn.microsoft.com/en-us/visualstudio/workflow-designer/error-messages-in-workflow-designer?view=vs-2022) — double-click error in Error List to navigate to source activity
- [xyflow / SvelteFlow GitHub](https://github.com/xyflow/xyflow) — EdgeLabelRenderer available for custom edge labels in SvelteFlow

---

*Feature research for: Minion Hub v2.0 Skill Builder Improvements*
*Researched: 2026-03-18*
