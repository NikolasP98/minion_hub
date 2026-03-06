# Marketplace i18n Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ~63 hardcoded user-facing strings in the marketplace UI with Paraglide i18n calls, adding English and Spanish translations.

**Architecture:** All strings live in `messages/en.json` and `messages/es.json`. After editing those files, run `bun run i18n:compile` to regenerate the TypeScript runtime at `src/lib/paraglide/`. Svelte components import `* as m from "$lib/paraglide/messages"` and call `m.key_name()`. Parameterized strings use `m.key({ param: value })`.

**Tech Stack:** `@inlang/paraglide-sveltekit`, `messages/*.json`, SvelteKit `.svelte` files, `bun run i18n:compile`.

---

## Key Reference

All new keys and their English values are listed here for copy-paste use throughout the plan.

### `messages/en.json` additions (append before closing `}`)

```json
  "marketplace_hirTagline": "Hire AI Agents",
  "marketplace_comingSoon": "Coming soon",

  "marketplace_agentsListSearchPlaceholder": "Search agents by name, role, or skill…",
  "marketplace_agentsListCategoryAll": "All",
  "marketplace_agentsListCategoryEngineering": "Engineering",
  "marketplace_agentsListCategoryProduct": "Product",
  "marketplace_agentsListCategoryData": "Data",
  "marketplace_agentsListCategoryCreative": "Creative",
  "marketplace_agentsListCategorySecurity": "Security",
  "marketplace_agentsListShowing": "Showing {count} agents",
  "marketplace_agentsListShowingIn": "in {category}",
  "marketplace_agentsListSortPopular": "Most Popular",
  "marketplace_agentsListSortNewest": "Newest",
  "marketplace_agentsListSortName": "Name (A–Z)",
  "marketplace_agentsListGridView": "Grid view",
  "marketplace_agentsListListView": "List view",
  "marketplace_agentsListLoading": "Loading agents…",
  "marketplace_agentsListEmpty": "No agents found",
  "marketplace_agentsListEmptyHint": "Try adjusting your filters or search terms",
  "marketplace_agentsListEmptySync": "The marketplace is empty. Refresh the page to sync agents.",
  "marketplace_agentsListClearFilters": "Clear filters",
  "marketplace_agentsListHires": "hires",
  "marketplace_agentsListVersion": "version",
  "marketplace_agentsListViewProfile": "View Profile",
  "marketplace_agentsListHireMe": "Hire Me",

  "marketplace_agentDetailBack": "← Back to Marketplace",
  "marketplace_agentDetailAvailable": "Available for Hire",
  "marketplace_agentDetailLoading": "Loading agent profile…",
  "marketplace_agentDetailNotFound": "Agent Not Found",
  "marketplace_agentDetailNotFoundHint": "This agent may have been removed or doesn't exist.",
  "marketplace_agentDetailHiringOptions": "Hiring Options",
  "marketplace_agentDetailDeployTo": "Deploy to Server",
  "marketplace_agentDetailNoServers": "No servers connected.",
  "marketplace_agentDetailConnectFirst": "Connect a server first →",
  "marketplace_agentDetailHiredSuccess": "Successfully Hired!",
  "marketplace_agentDetailHiredSuccessHint": "{name} has joined your team.",
  "marketplace_agentDetailHireBtn": "💼 Hire {name}",
  "marketplace_agentDetailHiring": "Hiring…",
  "marketplace_agentDetailHired": "Hired!",
  "marketplace_agentDetailSkillsTags": "Skills & Tags",
  "marketplace_agentDetailTabOverview": "Overview",
  "marketplace_agentDetailTabDocuments": "Documents",
  "marketplace_agentDetailAbout": "About",
  "marketplace_agentDetailDetails": "Details",
  "marketplace_agentDetailPerformance": "Performance",
  "marketplace_agentDetailCategory": "Category",
  "marketplace_agentDetailVersion": "Version",
  "marketplace_agentDetailModel": "Model",
  "marketplace_agentDetailSource": "Source",
  "marketplace_agentDetailTotalHires": "Total Hires",
  "marketplace_agentDetailJoined": "Joined",
  "marketplace_agentDetailLastUpdated": "Last Updated",

  "marketplace_agentCardRoleDescription": "Role Description",
  "marketplace_agentCardHireMe": "Hire Me",
  "marketplace_agentCardCorePurpose": "Core Purpose",
  "marketplace_agentCardCapabilities": "Capabilities",

  "marketplace_wizardStepOf": "Step {step} of {total}",
  "marketplace_wizardStep1Heading": "What does this agent do?",
  "marketplace_wizardStep1Subtitle": "Define their professional role and domain.",
  "marketplace_wizardStep1RoleLabel": "Role Title",
  "marketplace_wizardStep1RolePlaceholder": "e.g. DevOps Engineer, UX Designer, Growth Marketer",
  "marketplace_wizardStep1CategoryLabel": "Category",
  "marketplace_wizardStep2Heading": "Who are they?",
  "marketplace_wizardStep2Subtitle": "Give them a name and shape their personality.",
  "marketplace_wizardStep2NameLabel": "Full Name",
  "marketplace_wizardStep2NamePlaceholder": "e.g. Alex Rivera",
  "marketplace_wizardStep2CatchphraseLabel": "Catchphrase (optional)",
  "marketplace_wizardStep2CatchphrasePlaceholder": "Their signature sentence",
  "marketplace_wizardStep2ToneLabel": "Tone",
  "marketplace_wizardStep2ToneFormal": "Formal",
  "marketplace_wizardStep2ToneCasual": "Casual",
  "marketplace_wizardStep2RiskLabel": "Risk",
  "marketplace_wizardStep2RiskCautious": "Cautious",
  "marketplace_wizardStep2RiskBold": "Bold",
  "marketplace_wizardStep2ThinkingLabel": "Thinking",
  "marketplace_wizardStep2ThinkingTechnical": "Technical",
  "marketplace_wizardStep2ThinkingStrategic": "Strategic",
  "marketplace_wizardStep2Balanced": "Balanced",
  "marketplace_wizardStep3Heading": "Ready to generate",
  "marketplace_wizardStep3Body": "Claude will write {name}'s full identity — SOUL, IDENTITY, USER, CONTEXT, and SKILLS documents.",
  "marketplace_wizardStep3NameLabel": "Name:",
  "marketplace_wizardStep3RoleLabel": "Role:",
  "marketplace_wizardStep3CategoryLabel": "Category:",
  "marketplace_wizardStep3CatchphraseLabel": "Catchphrase:",
  "marketplace_wizardStep3Generate": "Generate Agent",
  "marketplace_wizardStep3Generating": "Generating identity…",
  "marketplace_wizardStep4Hint": "Looks good? Continue to export and push to GitHub.",
  "marketplace_wizardStep5Heading": "Export & Publish",
  "marketplace_wizardStep5Subtitle": "Download the agent files, add them to the minions repo, then sync.",
  "marketplace_wizardStep5DownloadBtn": "📥 Download Agent Files",
  "marketplace_wizardStep5SyncHeading": "Then sync in Minion Hub:",
  "marketplace_wizardStep5SyncHint": "Marketplace sidebar → ↻ Sync GitHub"
```

### `messages/es.json` additions (same keys, Spanish values)

```json
  "marketplace_hirTagline": "Contratar agentes IA",
  "marketplace_comingSoon": "Próximamente",

  "marketplace_agentsListSearchPlaceholder": "Busca agentes por nombre, rol o habilidad…",
  "marketplace_agentsListCategoryAll": "Todos",
  "marketplace_agentsListCategoryEngineering": "Ingeniería",
  "marketplace_agentsListCategoryProduct": "Producto",
  "marketplace_agentsListCategoryData": "Datos",
  "marketplace_agentsListCategoryCreative": "Creatividad",
  "marketplace_agentsListCategorySecurity": "Seguridad",
  "marketplace_agentsListShowing": "Mostrando {count} agentes",
  "marketplace_agentsListShowingIn": "en {category}",
  "marketplace_agentsListSortPopular": "Más popular",
  "marketplace_agentsListSortNewest": "Más reciente",
  "marketplace_agentsListSortName": "Nombre (A–Z)",
  "marketplace_agentsListGridView": "Vista de cuadrícula",
  "marketplace_agentsListListView": "Vista de lista",
  "marketplace_agentsListLoading": "Cargando agentes…",
  "marketplace_agentsListEmpty": "No se encontraron agentes",
  "marketplace_agentsListEmptyHint": "Intenta ajustar tus filtros o términos de búsqueda",
  "marketplace_agentsListEmptySync": "El marketplace está vacío. Actualiza la página para sincronizar agentes.",
  "marketplace_agentsListClearFilters": "Limpiar filtros",
  "marketplace_agentsListHires": "contrataciones",
  "marketplace_agentsListVersion": "versión",
  "marketplace_agentsListViewProfile": "Ver perfil",
  "marketplace_agentsListHireMe": "Contrátame",

  "marketplace_agentDetailBack": "← Volver al Marketplace",
  "marketplace_agentDetailAvailable": "Disponible para contratar",
  "marketplace_agentDetailLoading": "Cargando perfil del agente…",
  "marketplace_agentDetailNotFound": "Agente no encontrado",
  "marketplace_agentDetailNotFoundHint": "Este agente puede haber sido eliminado o no existe.",
  "marketplace_agentDetailHiringOptions": "Opciones de contratación",
  "marketplace_agentDetailDeployTo": "Desplegar en servidor",
  "marketplace_agentDetailNoServers": "Sin servidores conectados.",
  "marketplace_agentDetailConnectFirst": "Conecta un servidor primero →",
  "marketplace_agentDetailHiredSuccess": "¡Contratado con éxito!",
  "marketplace_agentDetailHiredSuccessHint": "{name} se ha unido a tu equipo.",
  "marketplace_agentDetailHireBtn": "💼 Contratar a {name}",
  "marketplace_agentDetailHiring": "Contratando…",
  "marketplace_agentDetailHired": "¡Contratado!",
  "marketplace_agentDetailSkillsTags": "Habilidades y etiquetas",
  "marketplace_agentDetailTabOverview": "Resumen",
  "marketplace_agentDetailTabDocuments": "Documentos",
  "marketplace_agentDetailAbout": "Acerca de",
  "marketplace_agentDetailDetails": "Detalles",
  "marketplace_agentDetailPerformance": "Rendimiento",
  "marketplace_agentDetailCategory": "Categoría",
  "marketplace_agentDetailVersion": "Versión",
  "marketplace_agentDetailModel": "Modelo",
  "marketplace_agentDetailSource": "Fuente",
  "marketplace_agentDetailTotalHires": "Contrataciones totales",
  "marketplace_agentDetailJoined": "Fecha de incorporación",
  "marketplace_agentDetailLastUpdated": "Última actualización",

  "marketplace_agentCardRoleDescription": "Descripción del rol",
  "marketplace_agentCardHireMe": "Contrátame",
  "marketplace_agentCardCorePurpose": "Propósito principal",
  "marketplace_agentCardCapabilities": "Capacidades",

  "marketplace_wizardStepOf": "Paso {step} de {total}",
  "marketplace_wizardStep1Heading": "¿Qué hace este agente?",
  "marketplace_wizardStep1Subtitle": "Define su rol profesional y dominio.",
  "marketplace_wizardStep1RoleLabel": "Título del rol",
  "marketplace_wizardStep1RolePlaceholder": "ej. Ingeniero DevOps, Diseñador UX, Especialista en Growth",
  "marketplace_wizardStep1CategoryLabel": "Categoría",
  "marketplace_wizardStep2Heading": "¿Quién es?",
  "marketplace_wizardStep2Subtitle": "Dale un nombre y define su personalidad.",
  "marketplace_wizardStep2NameLabel": "Nombre completo",
  "marketplace_wizardStep2NamePlaceholder": "ej. Alex Rivera",
  "marketplace_wizardStep2CatchphraseLabel": "Frase característica (opcional)",
  "marketplace_wizardStep2CatchphrasePlaceholder": "Su frase característica",
  "marketplace_wizardStep2ToneLabel": "Tono",
  "marketplace_wizardStep2ToneFormal": "Formal",
  "marketplace_wizardStep2ToneCasual": "Casual",
  "marketplace_wizardStep2RiskLabel": "Riesgo",
  "marketplace_wizardStep2RiskCautious": "Cauteloso",
  "marketplace_wizardStep2RiskBold": "Audaz",
  "marketplace_wizardStep2ThinkingLabel": "Pensamiento",
  "marketplace_wizardStep2ThinkingTechnical": "Técnico",
  "marketplace_wizardStep2ThinkingStrategic": "Estratégico",
  "marketplace_wizardStep2Balanced": "Equilibrado",
  "marketplace_wizardStep3Heading": "Listo para generar",
  "marketplace_wizardStep3Body": "Claude escribirá la identidad completa de {name} — documentos SOUL, IDENTITY, USER, CONTEXT y SKILLS.",
  "marketplace_wizardStep3NameLabel": "Nombre:",
  "marketplace_wizardStep3RoleLabel": "Rol:",
  "marketplace_wizardStep3CategoryLabel": "Categoría:",
  "marketplace_wizardStep3CatchphraseLabel": "Frase:",
  "marketplace_wizardStep3Generate": "Generar agente",
  "marketplace_wizardStep3Generating": "Generando identidad…",
  "marketplace_wizardStep4Hint": "¿Se ve bien? Continúa para exportar y subir a GitHub.",
  "marketplace_wizardStep5Heading": "Exportar y publicar",
  "marketplace_wizardStep5Subtitle": "Descarga los archivos del agente, agrégalos al repositorio de minions y sincroniza.",
  "marketplace_wizardStep5DownloadBtn": "📥 Descargar archivos del agente",
  "marketplace_wizardStep5SyncHeading": "Luego sincroniza en Minion Hub:",
  "marketplace_wizardStep5SyncHint": "Barra lateral del Marketplace → ↻ Sync GitHub"
```

---

## Task 1: Create feature worktree

**Files:** none yet

**Step 1: Create isolated worktree off dev**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
git worktree add .worktrees/marketplace-i18n -b feature/marketplace-i18n origin/dev
```

**Step 2: Verify it exists**

```bash
ls .worktrees/marketplace-i18n/src/
```

Expected: `app.css  app.d.ts  app.html  hooks.server.ts  lib  routes`

All subsequent tasks run inside `.worktrees/marketplace-i18n/`.

---

## Task 2: Add English keys to `messages/en.json`

**Files:**
- Modify: `messages/en.json` (last line is `"common_retry": "Retry"` followed by `}`)

**Step 1: Insert new keys before the closing `}`**

Open `messages/en.json`. Find the last line `"common_retry": "Retry"` and add a comma after it, then paste the full `en.json` additions block from the Key Reference section above. The file should still end with a single `}`.

**Step 2: Verify JSON is valid**

```bash
cd .worktrees/marketplace-i18n
node -e "require('./messages/en.json'); console.log('valid')"
```

Expected: `valid`

**Step 3: Commit**

```bash
git add messages/en.json
git commit -m "feat(i18n): add marketplace en translations"
```

---

## Task 3: Add Spanish keys to `messages/es.json`

**Files:**
- Modify: `messages/es.json`

**Step 1: Read the current es.json to find where to insert**

The file mirrors `en.json` structure. Find the last key (equivalent of `common_retry`) and add a comma, then paste the full `es.json` additions block from the Key Reference section above.

**Step 2: Verify JSON is valid**

```bash
node -e "require('./messages/es.json'); console.log('valid')"
```

Expected: `valid`

**Step 3: Commit**

```bash
git add messages/es.json
git commit -m "feat(i18n): add marketplace es translations"
```

---

## Task 4: Recompile i18n runtime

**Files:**
- Regenerated: `src/lib/paraglide/messages.js`, `src/lib/paraglide/messages/en.js`, `src/lib/paraglide/messages/es.js`

**Step 1: Run compile**

```bash
bun run i18n:compile
```

Expected: exits with no errors, no `[ERROR]` lines.

**Step 2: Verify new keys exist in generated file**

```bash
grep "marketplace_agentDetailBack" src/lib/paraglide/messages.js
```

Expected: one matching line (the exported function).

**Step 3: Commit generated files**

```bash
git add src/lib/paraglide/
git commit -m "chore(i18n): recompile paraglide runtime with marketplace keys"
```

---

## Task 5: Update `+layout.svelte`

**Files:**
- Modify: `src/routes/marketplace/+layout.svelte`

**Step 1: Read the file to locate hardcoded strings**

Find:
1. `"Hire AI Agents"` — brand tagline under Marketplace title
2. `"Agents"`, `"Skills"`, `"Tools"`, `"Integrations"`, `"Plugins"` — nav item labels (hardcoded)
3. `"Soon"` — badge label
4. `"Create Agent"` — sidebar button (already uses `m.marketplace_createAgent()` — skip if so)

**Step 2: Verify import exists**

Check the `<script>` block for:
```ts
import * as m from '$lib/paraglide/messages';
```
If missing, add it.

**Step 3: Replace hardcoded strings**

| Hardcoded | Replace with |
|---|---|
| `"Hire AI Agents"` | `{m.marketplace_hirTagline()}` |
| `"Soon"` (badge) | `{m.marketplace_comingSoon()}` — only the text node, keep surrounding markup |

The nav item labels (`"Agents"`, `"Skills"`, etc.) are rendered from a data array or repeated markup. If they are literals in the template:
- `"Agents"` → already covered by `m.marketplace_agents()`
- `"Skills"` / `"Tools"` / `"Integrations"` / `"Plugins"` → these are "coming soon" pages; use the nav label keys that already exist (`nav_marketplace` is there; check if `marketplace_skills` etc. exist — if not, use the literal names since they are proper nouns / not urgent to translate)

**Step 4: Type-check**

```bash
bun run check 2>&1 | head -40
```

Expected: 0 errors in `+layout.svelte`.

**Step 5: Commit**

```bash
git add src/routes/marketplace/+layout.svelte
git commit -m "feat(i18n): translate marketplace layout strings"
```

---

## Task 6: Update `agents/+page.svelte`

**Files:**
- Modify: `src/routes/marketplace/agents/+page.svelte`

**Step 1: Verify import**

Check `<script>` for `import * as m from '$lib/paraglide/messages';`. Add if missing.

**Step 2: Replace search placeholder**

Find:
```svelte
placeholder="Search agents by name, role, or skill..."
```
Replace with:
```svelte
placeholder={m.marketplace_agentsListSearchPlaceholder()}
```

**Step 3: Replace category pills array/labels**

The category pills are likely defined as an array like:
```ts
const categories = ['All', 'Engineering', 'Product', 'Data', 'Creative', 'Security'];
```

Replace with a derived array that uses message keys:
```ts
const categories = [
  { value: 'all', label: () => m.marketplace_agentsListCategoryAll() },
  { value: 'engineering', label: () => m.marketplace_agentsListCategoryEngineering() },
  { value: 'product', label: () => m.marketplace_agentsListCategoryProduct() },
  { value: 'data', label: () => m.marketplace_agentsListCategoryData() },
  { value: 'creative', label: () => m.marketplace_agentsListCategoryCreative() },
  { value: 'security', label: () => m.marketplace_agentsListCategorySecurity() },
];
```

Then in the template use `cat.label()` instead of `cat`.

> **Note:** If categories are plain strings used both as display labels AND as filter values, split them: keep the filter value as the lowercase English string, only translate the display label.

**Step 4: Replace toolbar text**

Find the "Showing {count} agents" string (likely a template literal or interpolation). Replace with:
```svelte
{m.marketplace_agentsListShowing({ count: filteredAgents.length })}
```

Find `"in {category}"`:
```svelte
{m.marketplace_agentsListShowingIn({ category: selectedCategory })}
```

**Step 5: Replace sort options**

Find the sort dropdown options array (likely `['Most Popular', 'Newest', 'Name (A-Z)']`). Replace with:
```ts
const sortOptions = [
  { value: 'popular', label: () => m.marketplace_agentsListSortPopular() },
  { value: 'newest', label: () => m.marketplace_agentsListSortNewest() },
  { value: 'name', label: () => m.marketplace_agentsListSortName() },
];
```

**Step 6: Replace view toggle aria-labels**

```svelte
aria-label={m.marketplace_agentsListGridView()}
aria-label={m.marketplace_agentsListListView()}
```

**Step 7: Replace loading state**

```svelte
<!-- was: "Loading agents..." -->
{m.marketplace_agentsListLoading()}
```

**Step 8: Replace empty states**

```svelte
<!-- was: "No agents found" -->
{m.marketplace_agentsListEmpty()}

<!-- was: "Try adjusting your filters or search terms" -->
{m.marketplace_agentsListEmptyHint()}

<!-- was: "The marketplace is empty. Refresh the page to sync agents." -->
{m.marketplace_agentsListEmptySync()}

<!-- was: "Clear filters" button -->
{m.marketplace_agentsListClearFilters()}
```

**Step 9: Replace list-view labels**

```svelte
<!-- was: "hires" -->
{m.marketplace_agentsListHires()}

<!-- was: "version" -->
{m.marketplace_agentsListVersion()}

<!-- was: "View Profile" -->
{m.marketplace_agentsListViewProfile()}

<!-- was: "Hire Me" -->
{m.marketplace_agentsListHireMe()}
```

**Step 10: Type-check**

```bash
bun run check 2>&1 | head -40
```

Expected: 0 errors in this file.

**Step 11: Commit**

```bash
git add src/routes/marketplace/agents/+page.svelte
git commit -m "feat(i18n): translate agents listing page"
```

---

## Task 7: Update `agents/[slug]/+page.svelte`

**Files:**
- Modify: `src/routes/marketplace/agents/[slug]/+page.svelte`

**Step 1: Verify import**

Check `<script>` for `import * as m from '$lib/paraglide/messages';`. Add if missing.

**Step 2: Replace all hardcoded strings** (work top-to-bottom through the file)

| Hardcoded literal | Replacement |
|---|---|
| `"← Back to Marketplace"` | `{m.marketplace_agentDetailBack()}` |
| `"Available for Hire"` | `{m.marketplace_agentDetailAvailable()}` |
| `"Loading agent profile…"` | `{m.marketplace_agentDetailLoading()}` |
| `"Agent Not Found"` | `{m.marketplace_agentDetailNotFound()}` |
| `"This agent may have been removed or doesn't exist."` | `{m.marketplace_agentDetailNotFoundHint()}` |
| `"Hiring Options"` | `{m.marketplace_agentDetailHiringOptions()}` |
| `"Deploy to Server"` | `{m.marketplace_agentDetailDeployTo()}` |
| `"No servers connected."` | `{m.marketplace_agentDetailNoServers()}` |
| `"Connect a server first →"` | `{m.marketplace_agentDetailConnectFirst()}` |
| `"Successfully Hired!"` | `{m.marketplace_agentDetailHiredSuccess()}` |
| `"{agent.name} has joined your team."` | `{m.marketplace_agentDetailHiredSuccessHint({ name: agent.name })}` |
| `"💼 Hire {agent.name}"` (button) | `{m.marketplace_agentDetailHireBtn({ name: agent.name })}` |
| `"Hiring..."` (button loading) | `{m.marketplace_agentDetailHiring()}` |
| `"Hired!"` (button done) | `{m.marketplace_agentDetailHired()}` |
| `"Skills & Tags"` | `{m.marketplace_agentDetailSkillsTags()}` |
| `"overview"` (tab label) | `{m.marketplace_agentDetailTabOverview()}` |
| `"documents"` (tab label) | `{m.marketplace_agentDetailTabDocuments()}` |
| `"About"` (card header) | `{m.marketplace_agentDetailAbout()}` |
| `"Details"` (card header) | `{m.marketplace_agentDetailDetails()}` |
| `"Performance"` (card header) | `{m.marketplace_agentDetailPerformance()}` |
| `"Category"` (detail label) | `{m.marketplace_agentDetailCategory()}` |
| `"Version"` (detail label) | `{m.marketplace_agentDetailVersion()}` |
| `"Model"` (detail label) | `{m.marketplace_agentDetailModel()}` |
| `"Source"` (detail label) | `{m.marketplace_agentDetailSource()}` |
| `"Total Hires"` | `{m.marketplace_agentDetailTotalHires()}` |
| `"Joined"` | `{m.marketplace_agentDetailJoined()}` |
| `"Last Updated"` | `{m.marketplace_agentDetailLastUpdated()}` |

> **Note on doc tab labels:** `"SOUL"`, `"IDENTITY"`, `"CONTEXT"`, `"SKILLS"` are document type identifiers used as both display labels and filter keys. Leave them as literals — they are proper nouns / technical terms, not UI prose.

**Step 3: Type-check**

```bash
bun run check 2>&1 | head -40
```

Expected: 0 errors in this file.

**Step 4: Commit**

```bash
git add src/routes/marketplace/agents/[slug]/+page.svelte
git commit -m "feat(i18n): translate agent detail page"
```

---

## Task 8: Update `AgentCard.svelte`

**Files:**
- Modify: `src/lib/components/marketplace/AgentCard.svelte`

**Step 1: Verify import**

Check `<script>` for `import * as m from '$lib/paraglide/messages';`. Add if missing.

**Step 2: Replace hardcoded strings**

| Hardcoded literal | Replacement |
|---|---|
| `"Role Description"` (front button + back title) | `{m.marketplace_agentCardRoleDescription()}` |
| `"Hire Me"` (back footer button) | `{m.marketplace_agentCardHireMe()}` |
| `"Core Purpose"` (section title) | `{m.marketplace_agentCardCorePurpose()}` |
| `"Capabilities"` (section title) | `{m.marketplace_agentCardCapabilities()}` |

> **Note:** The `"← "` arrow and `"📥 {count}"` install count format are visual/emoji — leave them as literals.

**Step 3: Type-check**

```bash
bun run check 2>&1 | head -40
```

Expected: 0 errors in this file.

**Step 4: Commit**

```bash
git add src/lib/components/marketplace/AgentCard.svelte
git commit -m "feat(i18n): translate AgentCard component"
```

---

## Task 9: Update `AgentCreatorWizard.svelte`

**Files:**
- Modify: `src/lib/components/marketplace/AgentCreatorWizard.svelte`

**Step 1: Verify import**

`import * as m` is already present (wizard nav buttons already use it). Confirm it's there.

**Step 2: Replace step indicator**

Find something like:
```svelte
Step {currentStep} of 5
```
Replace with:
```svelte
{m.marketplace_wizardStepOf({ step: currentStep, total: 5 })}
```

**Step 3: Replace Step 1 strings**

| Hardcoded | Replacement |
|---|---|
| `"What does this agent do?"` | `{m.marketplace_wizardStep1Heading()}` |
| `"Define their professional role and domain."` | `{m.marketplace_wizardStep1Subtitle()}` |
| `"Role Title"` (label) | `{m.marketplace_wizardStep1RoleLabel()}` |
| `"e.g. DevOps Engineer, UX Designer, Growth Marketer"` (placeholder) | `{m.marketplace_wizardStep1RolePlaceholder()}` |
| `"Category"` (label) | `{m.marketplace_wizardStep1CategoryLabel()}` |

**Step 4: Replace Step 2 strings**

| Hardcoded | Replacement |
|---|---|
| `"Who are they?"` | `{m.marketplace_wizardStep2Heading()}` |
| `"Give them a name and shape their personality."` | `{m.marketplace_wizardStep2Subtitle()}` |
| `"Full Name"` (label) | `{m.marketplace_wizardStep2NameLabel()}` |
| `"e.g. Alex Rivera"` (placeholder) | `{m.marketplace_wizardStep2NamePlaceholder()}` |
| `"Catchphrase (optional)"` (label) | `{m.marketplace_wizardStep2CatchphraseLabel()}` |
| `"Their signature sentence"` (placeholder) | `{m.marketplace_wizardStep2CatchphrasePlaceholder()}` |
| `"Tone"` | `{m.marketplace_wizardStep2ToneLabel()}` |
| `"Formal"` | `{m.marketplace_wizardStep2ToneFormal()}` |
| `"Casual"` | `{m.marketplace_wizardStep2ToneCasual()}` |
| `"Risk"` | `{m.marketplace_wizardStep2RiskLabel()}` |
| `"Cautious"` | `{m.marketplace_wizardStep2RiskCautious()}` |
| `"Bold"` | `{m.marketplace_wizardStep2RiskBold()}` |
| `"Thinking"` | `{m.marketplace_wizardStep2ThinkingLabel()}` |
| `"Technical"` | `{m.marketplace_wizardStep2ThinkingTechnical()}` |
| `"Strategic"` | `{m.marketplace_wizardStep2ThinkingStrategic()}` |
| `"Balanced"` (all three slider mid-labels) | `{m.marketplace_wizardStep2Balanced()}` |

**Step 5: Replace Step 3 strings**

| Hardcoded | Replacement |
|---|---|
| `"Ready to generate"` | `{m.marketplace_wizardStep3Heading()}` |
| `"Claude will write {name}'s full identity…"` | `{m.marketplace_wizardStep3Body({ name: form.name })}` |
| `"Name:"` | `{m.marketplace_wizardStep3NameLabel()}` |
| `"Role:"` | `{m.marketplace_wizardStep3RoleLabel()}` |
| `"Category:"` | `{m.marketplace_wizardStep3CategoryLabel()}` |
| `"Catchphrase:"` | `{m.marketplace_wizardStep3CatchphraseLabel()}` |
| `"Generate Agent"` (button) | `{m.marketplace_wizardStep3Generate()}` |
| `"Generating identity…"` (button disabled) | `{m.marketplace_wizardStep3Generating()}` |

> **Note:** The variable holding the name in the wizard might be `form.name`, `wizardData.name`, or similar — check the actual variable name in the `<script>` block and use the correct one.

**Step 6: Replace Step 4 strings**

| Hardcoded | Replacement |
|---|---|
| `"Looks good? Continue to export and push to GitHub."` | `{m.marketplace_wizardStep4Hint()}` |

> **Note:** The doc tab labels `"SOUL"`, `"IDENTITY"`, `"USER"`, `"CONTEXT"`, `"SKILLS"` in the preview are document type identifiers — leave as literals.

**Step 7: Replace Step 5 strings**

| Hardcoded | Replacement |
|---|---|
| `"Export & Publish"` (heading) | `{m.marketplace_wizardStep5Heading()}` |
| `"Download the agent files, add them to the minions repo, then sync."` | `{m.marketplace_wizardStep5Subtitle()}` |
| `"📥 Download Agent Files"` (button) | `{m.marketplace_wizardStep5DownloadBtn()}` |
| `"Then sync in Minion Hub:"` | `{m.marketplace_wizardStep5SyncHeading()}` |
| `"Marketplace sidebar → ↻ Sync GitHub"` | `{m.marketplace_wizardStep5SyncHint()}` |

> **Note:** The git command block (code snippet inside `<pre>` or `<code>`) is developer-facing instructions, not UI prose. Leave it as a hardcoded literal.

**Step 8: Type-check**

```bash
bun run check 2>&1 | head -40
```

Expected: 0 errors in this file.

**Step 9: Commit**

```bash
git add src/lib/components/marketplace/AgentCreatorWizard.svelte
git commit -m "feat(i18n): translate AgentCreatorWizard component"
```

---

## Task 10: Final type-check, build, and merge prep

**Step 1: Full type-check**

```bash
bun run check
```

Expected: 0 errors, 0 warnings related to our changes.

**Step 2: Production build**

```bash
bun run build
```

Expected: exits 0, no `[ERROR]` lines.

**Step 3: If build passes, commit any fixups and push**

```bash
git log --oneline origin/dev..HEAD
```

Expected: 6–8 commits (all the `feat(i18n):` commits from Tasks 1–9).

**Step 4: Open PR or merge to dev per project workflow**

```bash
# Option A — PR
gh pr create --base dev --title "feat(i18n): add marketplace translations (en + es)" \
  --body "Replaces ~63 hardcoded strings in marketplace UI with Paraglide i18n calls. Adds English and Spanish translations for agents listing, agent detail, AgentCard, and wizard components."

# Option B — direct merge
git checkout dev && git merge --no-ff feature/marketplace-i18n
```
