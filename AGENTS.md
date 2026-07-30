<claude-mem-context>
# Memory Context

# [minion_hub] recent context, 2026-07-23 12:54am GMT-5

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 25 obs (10,123t read) | 681,202t work | 99% savings

### Jun 20, 2026
S4936 Commit and push CRM hygiene overhaul to dev, then resolve post-rebase TypeScript errors (Jun 20, 1:28 AM)
S4937 Document stale-paraglide-after-rebase gotcha in project memory after resolving post-push TypeScript errors (Jun 20, 1:30 AM)
S6557 Adversarial implementation review of embeddings retry/backoff, bounded concurrency, and CLI table-targeting flags (Jun 20, 1:33 AM)
### Jul 22, 2026
31819 1:17a 🔵 Consumption UOM conversion infrastructure present but incomplete for Hialuronidasa
31820 " 🔵 Issue path precedence and modifiers already handle recipe-vs-bridge correctly
31832 1:18a 🔵 Hialuronidasa consumption UOM mismatch discovered in POS-stock bridge
31835 1:30a 🔴 Fixed UOM mixing in POS stock issuance
31885 3:02a 🟣 Embeddings API retry with exponential backoff
31886 " 🟣 Bounded concurrency for embedding batch processing
31887 " 🟣 Table-level corpus bootstrap control via CLI flags
S6558 Adversarial code review of embeddings retry/backoff, bounded concurrency, and CLI table-targeting flags with focus on deletion safety and data integrity (Jul 22, 3:02 AM)
S6560 Test request to reply with OK (Jul 22, 3:08 AM)
31892 3:10a 🔵 Business corpus deletion reconciliation is safe for partial runs
31893 " 🔵 embedTexts lacks response validation allowing undefined vectors to persist
31894 " 🔵 Bounded embedding concurrency implemented without fetch timeout
31895 " 🔵 CLI table-targeting flags enable resumable backfills with edge-case traps
S6559 Review pgvector rollout: remove unused message-id and agent-memory indexes; add pgvector 0.8 iterative_scan settings; restore 8,657-row IVFFlat first and 61,737-row HNSW second via standalone CREATE INDEX CONCURRENTLY; identify blockers and corrections without modifying files or databases. (Jul 22, 12:22 PM)
31997 12:25p 🔵 pgvector rollout blockers identified: IVFFlat restore forbidden, HNSW requires session-mode connection and maintenance_work_mem
S6563 PostgreSQL pgvector ANN index restoration strategy evaluation after storage capacity increase (Jul 22, 12:25 PM)
S6561 pgvector rollout review: verify proposed dual-index restore with iterative_scan settings; identify blockers and corrections without modifying files or databases. (Jul 22, 12:29 PM)
S6562 pgvector rollout review — analysis complete; durable findings archived to project memory for future sessions. (Jul 22, 12:29 PM)
31998 12:29p ✅ Project memory persisted: pgvector ANN restore review findings archived for future sessions
32004 12:30p ⚖️ Pre-deployment review of unified Brain knowledge architecture changes
32005 " 🔵 Focused Brain source-membership implementation review initiated
S6564 Read-only production blocker review of Focused Brain source-membership implementation across eight files (Jul 22, 12:36 PM)
### Jul 23, 2026
32261 12:00a 🔄 Centralized module-availability route guard
32262 " 🟣 Module availability manifest system
32263 " 🟣 Org kind resolved during identity resolution
32264 " ✅ Organizations kind column migration
32268 12:03a 🟣 Personal-org differentiation expanded to five business-only modules
32269 " 🟣 Personal-finance statement imports with resumable parsing
32270 " ✅ Finance summary and revenue series skip COGS for personal orgs
32272 " ✅ CRM funnel endpoint gated to business orgs only
32273 " ✅ Background job tick registers statement ingest handler
32274 12:04a 🔵 Test coverage confirms route guard and finance changes

Access 681k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>