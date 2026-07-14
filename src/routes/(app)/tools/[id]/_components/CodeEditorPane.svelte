<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Eye, EyeOff, Plus, Trash2, ChevronDown, ChevronRight, Copy, GripVertical } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';
	import { varAccessor, querySnippet, sqlTemplate, type Lang } from './tool-editor-snippets';
	import type { CompletionData } from './tool-editor-completions';

	type EnvVar = { key: string; value: string; revealed: boolean };
	type VarTab = 'env' | 'system' | 'module' | 'database' | 'queries';
	type VariablesData = {
		system: Array<{ key: string; description: string }>;
		module: Array<{ key: string; path: string; description: string }>;
		database: Array<{ key: string; value: string; description: string }>;
	} | null;
	type SchemaCatalog = { tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }> } | null;

	interface Props {
		scriptCode: string;
		scriptLang: Lang;
		defaultCode: Record<string, string>;
		envVars: EnvVar[];
		envVarsExpanded: boolean;
		isAdmin: boolean;
		variablesData: VariablesData;
		schemaCatalog: SchemaCatalog;
		onCodeChange: () => void;
		onAddEnvVar: () => void;
		onRemoveEnvVar: (index: number) => void;
		onToggleReveal: (index: number) => void;
		onToggleExpanded: () => void;
	}

	let {
		scriptCode = $bindable(),
		scriptLang,
		defaultCode,
		envVars = $bindable(),
		envVarsExpanded,
		isAdmin,
		variablesData,
		schemaCatalog,
		onCodeChange,
		onAddEnvVar,
		onRemoveEnvVar,
		onToggleReveal,
		onToggleExpanded,
	}: Props = $props();

	let activeVarTab = $state<VarTab>('env');

	const completionData = $derived<CompletionData>({
		envKeys: envVars.map((v) => v.key).filter(Boolean),
		systemKeys: (variablesData?.system ?? []).map((v) => v.key),
		moduleKeys: (variablesData?.module ?? []).map((v) => v.key),
		databaseKeys: (variablesData?.database ?? []).map((v) => v.key),
		modulePaths: (variablesData?.module ?? []).map((v) => v.path),
		tables: schemaCatalog?.tables ?? [],
	});

	// Query endpoints for the Queries tab: module vars pointing at /query/*.
	const queryEndpoints = $derived((variablesData?.module ?? []).filter((v) => v.path.includes('/query/')));

	function copyText(text: string) {
		navigator.clipboard?.writeText(text).catch(() => {});
	}

	// Chips set text/plain to the resolved insertion string; CM6's dropCursor
	// inserts it at the drop position natively.
	function onChipDrag(e: DragEvent, text: string) {
		e.dataTransfer?.setData('text/plain', text);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
	}
</script>

<!-- Left Pane: Code Editor + Env Vars -->
<div class="pane-left">
	<div class="editor-area">
		<CodeMirrorEditor
			bind:value={scriptCode}
			lang={scriptLang}
			readonly={!isAdmin}
			placeholder={defaultCode[scriptLang]}
			{completionData}
			onChange={onCodeChange}
		/>
	</div>

	<!-- Variables Panel: Env / System / Module / Database / Queries tabs -->
	<div class="env-panel" class:collapsed={!envVarsExpanded}>
		<div class="env-header">
			<Button variant="ghost"
				type="button"
				class="env-toggle"
				onclick={onToggleExpanded}
				title={envVarsExpanded ? 'Collapse' : 'Expand'}
			>
				{#if envVarsExpanded}
					<ChevronDown size={14} />
				{:else}
					<ChevronRight size={14} />
				{/if}
			</Button>
			<div class="var-tabs">
				<Button variant="ghost" type="button" class="var-tab" class:active={activeVarTab === 'env'} onclick={() => (activeVarTab = 'env')}>
					<span>{m.tools_editor_envVarsTab()}</span>
					<span class="env-count">{envVars.length}</span>
				</Button>
				<Button variant="ghost" type="button" class="var-tab" class:active={activeVarTab === 'system'} onclick={() => (activeVarTab = 'system')}>
					{m.tools_editor_systemVarsTab()}
				</Button>
				<Button variant="ghost" type="button" class="var-tab" class:active={activeVarTab === 'module'} onclick={() => (activeVarTab = 'module')}>
					{m.tools_editor_moduleVarsTab()}
				</Button>
				<Button variant="ghost" type="button" class="var-tab" class:active={activeVarTab === 'database'} onclick={() => (activeVarTab = 'database')}>
					{m.tools_editor_databaseVarsTab()}
				</Button>
				<Button variant="ghost" type="button" class="var-tab" class:active={activeVarTab === 'queries'} onclick={() => (activeVarTab = 'queries')}>
					{m.tools_editor_queriesTab()}
				</Button>
			</div>
		</div>

		{#if envVarsExpanded}
			<div class="env-body">
				{#if activeVarTab === 'env'}
					{#each envVars as envVar, i (i)}
						<div class="env-row">
							<span
								class="chip-grip"
								draggable="true"
								role="button"
								tabindex="-1"
								aria-label={m.tools_editor_dragToInsert()}
								title={m.tools_editor_dragToInsert()}
								ondragstart={(e) => onChipDrag(e, varAccessor(scriptLang, envVar.key))}
							>
								<GripVertical size={12} />
							</span>
							<input type="text" class="env-key" bind:value={envVar.key} placeholder="KEY" oninput={onCodeChange} />
							<span class="env-eq">=</span>
							<div class="env-value-wrap">
								{#if envVar.revealed}
									<input type="text" class="env-value" bind:value={envVar.value} placeholder="value" oninput={onCodeChange} />
								{:else}
									<input type="password" class="env-value" bind:value={envVar.value} placeholder="value" oninput={onCodeChange} />
								{/if}
								<Button variant="ghost"
									type="button"
									class="env-reveal"
									onclick={() => onToggleReveal(i)}
									title={envVar.revealed ? 'Hide value' : 'Reveal value'}
								>
									{#if envVar.revealed}
										<EyeOff size={12} />
									{:else}
										<Eye size={12} />
									{/if}
								</Button>
							</div>
							<Button variant="ghost" type="button" class="env-remove" onclick={() => onRemoveEnvVar(i)} title="Remove variable">
								<Trash2 size={12} />
							</Button>
						</div>
					{/each}
					<Button variant="ghost" type="button" class="env-add" onclick={onAddEnvVar}>
						<Plus size={12} />
						<span>{m.builder_addVariable()}</span>
					</Button>
				{:else if activeVarTab === 'system'}
					{#each variablesData?.system ?? [] as v (v.key)}
						<div
							class="var-row draggable"
							draggable="true"
							role="button"
							tabindex="0"
							title={m.tools_editor_dragToInsert()}
							ondragstart={(e) => onChipDrag(e, varAccessor(scriptLang, v.key))}
						>
							<div class="var-row-main">
								<span class="var-key"><GripVertical size={11} class="grip" />{v.key}</span>
								<Button variant="ghost" type="button" class="var-copy" onclick={() => copyText(varAccessor(scriptLang, v.key))} title={m.tools_editor_copyKey()}>
									<Copy size={11} />
								</Button>
							</div>
							<span class="var-desc">{v.description}</span>
						</div>
					{:else}
						<div class="var-empty">{m.tools_editor_noVars()}</div>
					{/each}
				{:else if activeVarTab === 'module'}
					{#each variablesData?.module ?? [] as v (v.key)}
						<div
							class="var-row draggable"
							draggable="true"
							role="button"
							tabindex="0"
							title={m.tools_editor_dragToInsert()}
							ondragstart={(e) => onChipDrag(e, varAccessor(scriptLang, v.key))}
						>
							<div class="var-row-main">
								<span class="var-key"><GripVertical size={11} class="grip" />{v.key}</span>
								<Button variant="ghost" type="button" class="var-copy" onclick={() => copyText(varAccessor(scriptLang, v.key))} title={m.tools_editor_copyKey()}>
									<Copy size={11} />
								</Button>
							</div>
							<span class="var-path">{v.path}</span>
							<span class="var-desc">{v.description}</span>
						</div>
					{:else}
						<div class="var-empty">{m.tools_editor_noVars()}</div>
					{/each}
				{:else if activeVarTab === 'database'}
					{#each variablesData?.database ?? [] as v (v.key)}
						<div
							class="var-row draggable"
							draggable="true"
							role="button"
							tabindex="0"
							title={m.tools_editor_dragToInsert()}
							ondragstart={(e) => onChipDrag(e, varAccessor(scriptLang, v.key))}
						>
							<div class="var-row-main">
								<span class="var-key"><GripVertical size={11} class="grip" />{v.key}</span>
								<Button variant="ghost" type="button" class="var-copy" onclick={() => copyText(varAccessor(scriptLang, v.key))} title={m.tools_editor_copyKey()}>
									<Copy size={11} />
								</Button>
							</div>
							{#if v.value}<span class="var-path">{v.value}</span>{/if}
							<span class="var-desc">{v.description}</span>
						</div>
					{:else}
						<div class="var-empty">{m.tools_editor_noVars()}</div>
					{/each}
				{:else}
					<!-- Queries tab -->
					<p class="queries-note">{m.tools_editor_queriesNote()}</p>
					{#if queryEndpoints.length}
						<div class="queries-section-label">{m.tools_editor_queryEndpoints()}</div>
					{/if}
					{#each queryEndpoints as v (v.key)}
						{@const snippet = querySnippet(scriptLang, v.path)}
						<div
							class="snippet-card draggable"
							draggable="true"
							role="button"
							tabindex="0"
							title={m.tools_editor_dragToInsert()}
							ondragstart={(e) => onChipDrag(e, snippet)}
						>
							<div class="snippet-head">
								<span class="var-key"><GripVertical size={11} class="grip" />{v.path}</span>
								<Button variant="ghost" type="button" class="var-copy" onclick={() => copyText(snippet)} title={m.tools_editor_copySnippet()}>
									<Copy size={11} />
								</Button>
							</div>
							<pre class="snippet-code">{snippet}</pre>
						</div>
					{/each}

					{#if (schemaCatalog?.tables ?? []).length}
						<div class="queries-section-label">{m.tools_editor_dbTables()}</div>
					{/if}
					{#each schemaCatalog?.tables ?? [] as tbl (tbl.name)}
						{@const tmpl = sqlTemplate(tbl.name, tbl.columns)}
						<div
							class="snippet-card draggable"
							draggable="true"
							role="button"
							tabindex="0"
							title={m.tools_editor_dragToInsert()}
							ondragstart={(e) => onChipDrag(e, tmpl)}
						>
							<div class="snippet-head">
								<span class="var-key"><GripVertical size={11} class="grip" />{tbl.name}</span>
								<Button variant="ghost" type="button" class="var-copy" onclick={() => copyText(tmpl)} title={m.tools_editor_copySnippet()}>
									<Copy size={11} />
								</Button>
							</div>
							<pre class="snippet-code">{tmpl}</pre>
						</div>
					{/each}

					{#if !queryEndpoints.length && !(schemaCatalog?.tables ?? []).length}
						<div class="var-empty">{m.tools_editor_noVars()}</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.pane-left {
		display: flex;
		flex-direction: column;
		width: 60%;
		min-width: 0;
		min-height: 0;
	}

	/* ── Editor Area ─────────────────────────────────────────────────── */
	.editor-area {
		flex: 1;
		min-height: 0;
		display: flex;
		overflow: hidden;
	}

	/* ── Env Vars Panel ──────────────────────────────────────────────── */
	.env-panel {
		flex-shrink: 0;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg2);
	}

	.env-panel:not(.collapsed) {
		height: 200px;
		display: flex;
		flex-direction: column;
	}

	.env-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		flex-shrink: 0;
	}

	.env-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-muted);
		transition: color var(--duration-fast) var(--ease-standard);
	}

	.env-toggle:hover {
		color: var(--color-foreground);
	}

	/* ── Variable Tabs ───────────────────────────────────────────────── */
	.var-tabs {
		display: flex;
		align-items: center;
		gap: var(--space-0-5);
		overflow-x: auto;
	}

	.var-tab {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-md);
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-muted);
		font-family: inherit;
		font-size: var(--font-size-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
		transition: all var(--duration-fast) var(--ease-standard);
	}

	.var-tab:hover {
		color: var(--color-foreground);
		background: var(--color-bg3);
	}

	.var-tab.active {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.env-count {
		font-size: var(--font-size-telemetry);
		color: var(--color-muted);
		background: var(--color-bg3);
		padding: var(--space-0-5) var(--space-2);
		border-radius: var(--radius-full);
		font-weight: 500;
	}

	.env-body {
		flex: 1;
		overflow-y: auto;
		padding: 0 var(--space-3) var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.env-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		background: var(--color-bg3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.chip-grip {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-muted);
		cursor: grab;
		opacity: 0.6;
	}

	.chip-grip:hover {
		color: var(--color-accent);
		opacity: 1;
	}

	.chip-grip:active {
		cursor: grabbing;
	}

	.env-key {
		width: 8rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		color: var(--color-foreground);
		background: transparent;
		border: none;
		outline: none;
		padding: var(--space-0-5) 0;
		text-transform: uppercase;
	}

	.env-key::placeholder {
		color: var(--color-muted);
		text-transform: uppercase;
	}

	.env-eq {
		font-size: var(--font-size-caption);
		color: var(--color-muted);
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		flex-shrink: 0;
	}

	.env-value-wrap {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
	}

	.env-value {
		flex: 1;
		font-size: var(--font-size-caption);
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		color: var(--color-foreground);
		background: transparent;
		border: none;
		outline: none;
		padding: var(--space-0-5) 0;
		min-width: 0;
	}

	.env-value::placeholder {
		color: var(--color-muted);
	}

	.env-reveal {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-sm);
		color: var(--color-muted);
		background: none;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: color var(--duration-instant) var(--ease-standard);
	}

	.env-reveal:hover {
		color: var(--color-foreground);
	}

	.env-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-sm);
		color: var(--color-muted);
		background: none;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: all var(--duration-instant) var(--ease-standard);
		opacity: 0.5;
	}

	.env-row:hover .env-remove {
		opacity: 1;
	}

	.env-remove:hover {
		color: var(--color-danger-fg);
		background: var(--color-danger-surface);
	}

	.env-add {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-muted);
		font-size: var(--font-size-caption);
		font-weight: 500;
		cursor: pointer;
		transition: all var(--duration-fast) var(--ease-standard);
		font-family: inherit;
	}

	.env-add:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 4%, transparent);
	}

	/* ── Read-only Variable Rows (System / Module / Database) ────────── */
	.var-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
		padding: var(--space-2) var(--space-2);
		background: var(--color-bg3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.var-row.draggable,
	.snippet-card.draggable {
		cursor: grab;
	}

	.var-row.draggable:active,
	.snippet-card.draggable:active {
		cursor: grabbing;
	}

	.var-row.draggable:hover,
	.snippet-card.draggable:hover {
		border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
	}

	.var-row-main,
	.snippet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.var-key {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-caption);
		font-weight: 600;
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		color: var(--color-foreground);
	}

	.var-key :global(.grip) {
		color: var(--color-muted);
		opacity: 0.6;
		flex-shrink: 0;
	}

	.var-copy {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		color: var(--color-muted);
		background: none;
		border: none;
		cursor: pointer;
		transition: color var(--duration-instant) var(--ease-standard);
	}

	.var-copy:hover {
		color: var(--color-accent);
	}

	.var-path {
		font-size: var(--font-size-caption);
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		color: var(--color-accent);
	}

	.var-desc {
		font-size: var(--font-size-caption);
		color: var(--color-muted);
	}

	.var-empty {
		font-size: var(--font-size-caption);
		color: var(--color-muted);
		font-style: italic;
		padding: var(--space-2);
	}

	/* ── Queries tab ─────────────────────────────────────────────────── */
	.queries-note {
		font-size: var(--font-size-caption);
		color: var(--color-muted);
		margin: var(--space-0-5) var(--space-1) var(--space-1);
		line-height: 1.5;
	}

	.queries-section-label {
		font-size: var(--font-size-telemetry);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted);
		margin-top: var(--space-1);
		padding: 0 var(--space-1);
	}

	.snippet-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--color-bg3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.snippet-code {
		margin: 0;
		font-size: var(--font-size-caption);
		font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
		color: var(--color-foreground);
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
		max-height: 8rem;
		overflow-y: auto;
	}
</style>
