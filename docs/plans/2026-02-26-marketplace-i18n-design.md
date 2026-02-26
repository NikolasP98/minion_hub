# Marketplace i18n — Design Doc

**Date:** 2026-02-26
**Branch:** feature/marketplace-i18n (off `dev`)
**Scope:** Additive — new keys only, no existing key renames.

---

## Background

Minion Hub uses `@inlang/paraglide-sveltekit` for i18n with English (en) and Spanish (es) support. As of this writing, 28 marketplace strings are already translated. ~60+ hardcoded user-facing strings remain across the marketplace UI.

---

## Naming Convention

Follow the existing camelCase sub-prefix pattern already present in the codebase:

```
section_subSection[Descriptor]
```

Examples from existing code: `marketplace_wizardTitle`, `users_inviteEmail`, `reliability_gatewayTitle`.

No structural changes to existing keys.

---

## New Key Groups

### `marketplace_agentsList*` — Agents listing page (~20 keys)

| Key | English |
|---|---|
| `marketplace_agentsListSearchPlaceholder` | Search agents by name, role, or skill… |
| `marketplace_agentsListCategoryAll` | All |
| `marketplace_agentsListCategoryEngineering` | Engineering |
| `marketplace_agentsListCategoryProduct` | Product |
| `marketplace_agentsListCategoryData` | Data |
| `marketplace_agentsListCategoryCreative` | Creative |
| `marketplace_agentsListCategorySecurity` | Security |
| `marketplace_agentsListShowing` | Showing {count} agents |
| `marketplace_agentsListShowingIn` | in {category} |
| `marketplace_agentsListSortPopular` | Most Popular |
| `marketplace_agentsListSortNewest` | Newest |
| `marketplace_agentsListSortName` | Name (A–Z) |
| `marketplace_agentsListGridView` | Grid view |
| `marketplace_agentsListListView` | List view |
| `marketplace_agentsListLoading` | Loading agents… |
| `marketplace_agentsListEmpty` | No agents found |
| `marketplace_agentsListEmptyHint` | Try adjusting your filters or search terms |
| `marketplace_agentsListEmptySync` | The marketplace is empty. Refresh the page to sync agents. |
| `marketplace_agentsListClearFilters` | Clear filters |
| `marketplace_agentsListHires` | hires |
| `marketplace_agentsListViewProfile` | View Profile |
| `marketplace_agentsListHireMe` | Hire Me |

### `marketplace_agentDetail*` — Agent detail page (~22 keys)

| Key | English |
|---|---|
| `marketplace_agentDetailBack` | ← Back to Marketplace |
| `marketplace_agentDetailAvailable` | Available for Hire |
| `marketplace_agentDetailLoading` | Loading agent profile… |
| `marketplace_agentDetailNotFound` | Agent Not Found |
| `marketplace_agentDetailNotFoundHint` | This agent may have been removed or doesn't exist. |
| `marketplace_agentDetailHiringOptions` | Hiring Options |
| `marketplace_agentDetailDeployTo` | Deploy to Server |
| `marketplace_agentDetailNoServers` | No servers connected. |
| `marketplace_agentDetailConnectFirst` | Connect a server first → |
| `marketplace_agentDetailHiredSuccess` | Successfully Hired! |
| `marketplace_agentDetailHiredSuccessHint` | {name} has joined your team. |
| `marketplace_agentDetailHireBtn` | 💼 Hire {name} |
| `marketplace_agentDetailHiring` | Hiring… |
| `marketplace_agentDetailHired` | Hired! |
| `marketplace_agentDetailSkillsTags` | Skills & Tags |
| `marketplace_agentDetailTabOverview` | Overview |
| `marketplace_agentDetailTabDocuments` | Documents |
| `marketplace_agentDetailAbout` | About |
| `marketplace_agentDetailDetails` | Details |
| `marketplace_agentDetailPerformance` | Performance |
| `marketplace_agentDetailCategory` | Category |
| `marketplace_agentDetailVersion` | Version |
| `marketplace_agentDetailModel` | Model |
| `marketplace_agentDetailSource` | Source |
| `marketplace_agentDetailTotalHires` | Total Hires |
| `marketplace_agentDetailJoined` | Joined |
| `marketplace_agentDetailLastUpdated` | Last Updated |

### `marketplace_agentCard*` — AgentCard component (~5 keys)

| Key | English |
|---|---|
| `marketplace_agentCardRoleDescription` | Role Description |
| `marketplace_agentCardHireMe` | Hire Me |
| `marketplace_agentCardCorePurpose` | Core Purpose |
| `marketplace_agentCardCapabilities` | Capabilities |

### `marketplace_wizard*` — Wizard steps (new additions to existing group, ~14 keys)

| Key | English |
|---|---|
| `marketplace_wizardStepOf` | Step {step} of {total} |
| `marketplace_wizardStep1Heading` | What does this agent do? |
| `marketplace_wizardStep1Subtitle` | Define their professional role and domain. |
| `marketplace_wizardStep1RoleLabel` | Role Title |
| `marketplace_wizardStep1RolePlaceholder` | e.g. DevOps Engineer, UX Designer, Growth Marketer |
| `marketplace_wizardStep1CategoryLabel` | Category |
| `marketplace_wizardStep2Heading` | Who are they? |
| `marketplace_wizardStep2Subtitle` | Give them a name and shape their personality. |
| `marketplace_wizardStep2NameLabel` | Full Name |
| `marketplace_wizardStep2NamePlaceholder` | e.g. Alex Rivera |
| `marketplace_wizardStep2CatchphraseLabel` | Catchphrase (optional) |
| `marketplace_wizardStep2CatchphrasePlaceholder` | Their signature sentence |
| `marketplace_wizardStep2ToneLabel` | Tone |
| `marketplace_wizardStep2ToneFormal` | Formal |
| `marketplace_wizardStep2ToneCasual` | Casual |
| `marketplace_wizardStep2RiskLabel` | Risk |
| `marketplace_wizardStep2RiskCautious` | Cautious |
| `marketplace_wizardStep2RiskBold` | Bold |
| `marketplace_wizardStep2ThinkingLabel` | Thinking |
| `marketplace_wizardStep2ThinkingTechnical` | Technical |
| `marketplace_wizardStep2ThinkingStrategic` | Strategic |
| `marketplace_wizardStep2Balanced` | Balanced |
| `marketplace_wizardStep3Heading` | Ready to generate |
| `marketplace_wizardStep3Body` | Claude will write {name}'s full identity — SOUL, IDENTITY, USER, CONTEXT, and SKILLS documents. |
| `marketplace_wizardStep3NameLabel` | Name: |
| `marketplace_wizardStep3RoleLabel` | Role: |
| `marketplace_wizardStep3CategoryLabel` | Category: |
| `marketplace_wizardStep3CatchphraseLabel` | Catchphrase: |
| `marketplace_wizardStep3Generate` | Generate Agent |
| `marketplace_wizardStep3Generating` | Generating identity… |
| `marketplace_wizardStep4Hint` | Looks good? Continue to export and push to GitHub. |
| `marketplace_wizardStep5Heading` | Export & Publish |
| `marketplace_wizardStep5Subtitle` | Download the agent files, add them to the minions repo, then sync. |
| `marketplace_wizardStep5DownloadBtn` | 📥 Download Agent Files |
| `marketplace_wizardStep5SyncHeading` | Then sync in Minion Hub: |
| `marketplace_wizardStep5SyncHint` | Marketplace sidebar → ↻ Sync GitHub |

### Flat `marketplace_*` additions (~2 keys)

| Key | English |
|---|---|
| `marketplace_hirTagline` | Hire AI Agents |
| `marketplace_comingSoon` | Coming soon |

---

## Files Changed

| File | Change |
|---|---|
| `messages/en.json` | Add ~63 keys |
| `messages/es.json` | Add Spanish translations for all ~63 keys |
| `src/routes/marketplace/+layout.svelte` | Replace hardcoded sidebar strings |
| `src/routes/marketplace/agents/+page.svelte` | Replace all hardcoded UI strings |
| `src/routes/marketplace/agents/[slug]/+page.svelte` | Replace all hardcoded UI strings |
| `src/lib/components/marketplace/AgentCard.svelte` | Replace hardcoded card strings |
| `src/lib/components/marketplace/AgentCreatorWizard.svelte` | Replace remaining hardcoded wizard strings |
| _(post-edit)_ `bun run i18n:compile` | Regenerate paraglide runtime |

## Out of Scope

- Existing key renames or restructuring
- Non-marketplace routes
- Backend / API / DB changes
- Coming-soon stub pages beyond `marketplace_comingSoon`
