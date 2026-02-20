<script lang="ts">
  import type { JsonSchemaNode, ConfigUiHint } from '$lib/types/config';
  import { REDACTED_SENTINEL } from '$lib/types/config';
  import { resolveFieldType } from '$lib/utils/config-schema';
  import { setField, getOriginalField, configState } from '$lib/state/config.svelte';
  import ConfigJsonEditor from './ConfigJsonEditor.svelte';
  import ConfigField from './ConfigField.svelte';

  let { path, schema, hint = {}, value, depth = 0 }: {
    path: string;
    schema: JsonSchemaNode;
    hint?: ConfigUiHint;
    value: unknown;
    depth?: number;
  } = $props();

  const fieldType = $derived(resolveFieldType(schema, hint));
  const label = $derived(hint.label ?? schema.title ?? lastSegment(path));
  const helpText = $derived(hint.help ?? schema.description);
  const isRedacted = $derived(value === REDACTED_SENTINEL);
  const placeholder = $derived(hint.placeholder ?? schema.default?.toString() ?? '');

  // For sensitive fields
  let showSensitive = $state(false);

  // For record (key-value) fields
  let newRecordKey = $state('');

  // For array-string fields
  let newArrayItem = $state('');

  // ─── Event handlers ─────────────────────────────────────────────────────

  function onStringInput(e: Event) {
    setField(path, (e.target as HTMLInputElement).value);
  }

  function onNumberInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    if (raw === '') {
      setField(path, undefined);
    } else {
      const num = Number(raw);
      if (!Number.isNaN(num)) setField(path, num);
    }
  }

  function onBooleanToggle() {
    setField(path, !value);
  }

  function onEnumSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    setField(path, val === '__NONE__' ? undefined : val);
  }

  function onSelectChange(e: Event) {
    const raw = (e.target as HTMLSelectElement).value;
    if (raw === '__NONE__') { setField(path, undefined); return; }
    // Try to parse as JSON for typed const values
    try { setField(path, JSON.parse(raw)); } catch { setField(path, raw); }
  }

  function onSensitiveInput(e: Event) {
    setField(path, (e.target as HTMLInputElement).value);
  }

  function resetSensitive() {
    const orig = getOriginalField(path);
    setField(path, orig);
    showSensitive = false;
  }

  // Array-string helpers
  function addArrayItem() {
    const trimmed = newArrayItem.trim();
    if (!trimmed) return;
    const arr = Array.isArray(value) ? [...(value as string[])] : [];
    arr.push(trimmed);
    setField(path, arr);
    newArrayItem = '';
  }

  function removeArrayItem(index: number) {
    if (!Array.isArray(value)) return;
    const arr = [...(value as string[])];
    arr.splice(index, 1);
    setField(path, arr);
  }

  // Record helpers
  function addRecordEntry() {
    const key = newRecordKey.trim();
    if (!key) return;
    const obj = (value && typeof value === 'object' && !Array.isArray(value))
      ? { ...(value as Record<string, unknown>) }
      : {};
    obj[key] = '';
    setField(path, obj);
    newRecordKey = '';
  }

  function removeRecordEntry(key: string) {
    if (!value || typeof value !== 'object') return;
    const obj = { ...(value as Record<string, unknown>) };
    delete obj[key];
    setField(path, obj);
  }

  function onRecordValueInput(key: string, e: Event) {
    const obj = (value && typeof value === 'object' && !Array.isArray(value))
      ? { ...(value as Record<string, unknown>) }
      : {};
    obj[key] = (e.target as HTMLInputElement).value;
    setField(path, obj);
  }

  // Array-object helpers
  function addArrayObject() {
    const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
    arr.push({});
    setField(path, arr);
  }

  function removeArrayObject(index: number) {
    if (!Array.isArray(value)) return;
    const arr = [...(value as unknown[])];
    arr.splice(index, 1);
    setField(path, arr);
  }

  // Multi-enum helpers
  function isChecked(option: unknown): boolean {
    return Array.isArray(value) && (value as unknown[]).includes(option);
  }

  function toggleMultiEnum(option: unknown) {
    const arr = Array.isArray(value) ? [...(value as unknown[])] : [];
    const idx = arr.indexOf(option);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(option);
    setField(path, arr);
  }

  function lastSegment(p: string): string {
    const parts = p.split('.');
    return parts[parts.length - 1];
  }

  // Select variants helper
  function getSelectOptions(s: JsonSchemaNode): { label: string; value: string }[] {
    const variants = s.anyOf ?? s.oneOf ?? [];
    return variants.map((v) => {
      const val = v.const ?? v.enum?.[0];
      return { label: v.title ?? String(val), value: JSON.stringify(val) };
    });
  }

  const inputClass = 'bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] font-[inherit] text-xs outline-none transition-colors focus:border-accent w-full';
  const labelClass = 'text-[11px] text-muted-foreground';
</script>

<!-- ─── Render based on field type ──────────────────────────────────── -->

{#if fieldType === 'object'}
  <!-- Nested object: render each property recursively -->
  <fieldset class="border-none p-0 m-0 space-y-3 {depth > 0 ? 'pl-3 border-l border-border' : ''}">
    {#if depth > 0}
      <legend class="text-xs font-semibold text-foreground">{label}</legend>
    {/if}
    {#if helpText}
      <p class="text-[10px] text-muted-foreground -mt-1">{helpText}</p>
    {/if}
    {#if schema.properties}
      {#each Object.entries(schema.properties) as [key, propSchema] (key)}
        {@const childPath = `${path}.${key}`}
        {@const childHint = configState.uiHints[childPath] ?? {}}
        {@const childValue = value != null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined}
        <ConfigField
          path={childPath}
          schema={propSchema}
          hint={childHint}
          value={childValue}
          depth={depth + 1}
        />
      {/each}
    {/if}
  </fieldset>

{:else if fieldType === 'sensitive'}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <div class="flex gap-2 items-center">
      <input
        class={inputClass}
        type={showSensitive ? 'text' : 'password'}
        value={isRedacted ? '' : (value as string ?? '')}
        placeholder={isRedacted ? 'Redacted — type to replace' : placeholder}
        oninput={onSensitiveInput}
      />
      <button
        type="button"
        class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[11px] py-[5px] px-2 shrink-0 transition-colors hover:text-foreground"
        onclick={() => showSensitive = !showSensitive}
        title={showSensitive ? 'Hide' : 'Show'}
      >
        {showSensitive ? 'Hide' : 'Show'}
      </button>
      {#if !isRedacted && value !== getOriginalField(path)}
        <button
          type="button"
          class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[11px] py-[5px] px-2 shrink-0 transition-colors hover:text-foreground"
          onclick={resetSensitive}
        >
          Reset
        </button>
      {/if}
    </div>
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'boolean'}
  <div class="flex items-center gap-3">
    <button
      type="button"
      class="relative w-8 h-[18px] rounded-full border transition-colors cursor-pointer shrink-0
        {value ? 'bg-accent border-accent' : 'bg-bg3 border-border'}"
      onclick={onBooleanToggle}
      role="switch"
      aria-checked={!!value}
    >
      <span
        class="absolute top-[2px] w-3 h-3 rounded-full bg-white transition-transform shadow-sm
          {value ? 'translate-x-[16px]' : 'translate-x-[2px]'}"
      ></span>
    </button>
    <span class={labelClass}>{label}</span>
    {#if helpText}<span class="text-[10px] text-muted-foreground ml-2">{helpText}</span>{/if}
  </div>

{:else if fieldType === 'enum'}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <select class={inputClass} value={value ?? '__NONE__'} onchange={onEnumSelect}>
      <option value="__NONE__">— none —</option>
      {#each (schema.enum ?? []) as option}
        <option value={String(option)}>{String(option)}</option>
      {/each}
    </select>
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'select'}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <select class={inputClass} value={value !== undefined ? JSON.stringify(value) : '__NONE__'} onchange={onSelectChange}>
      <option value="__NONE__">— none —</option>
      {#each getSelectOptions(schema) as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'number'}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <input
      class={inputClass}
      type="number"
      value={value ?? ''}
      min={schema.minimum}
      max={schema.maximum}
      placeholder={placeholder}
      oninput={onNumberInput}
    />
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'string'}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <input
      class={inputClass}
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      oninput={onStringInput}
    />
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'array-string'}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <div class="flex flex-wrap gap-1.5 mb-1.5">
      {#each (Array.isArray(value) ? value as string[] : []) as item, i}
        <span class="inline-flex items-center gap-1 bg-bg3 border border-border rounded-full py-[2px] pl-2.5 pr-1 text-xs text-foreground">
          {item}
          <button
            type="button"
            class="bg-transparent border-none text-muted-foreground cursor-pointer text-[10px] p-0 leading-none hover:text-destructive"
            onclick={() => removeArrayItem(i)}
          >&times;</button>
        </span>
      {/each}
    </div>
    <div class="flex gap-1.5">
      <input
        class={inputClass}
        type="text"
        bind:value={newArrayItem}
        placeholder="Add item…"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArrayItem(); } }}
      />
      <button
        type="button"
        class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-xs py-[5px] px-2 shrink-0 transition-colors hover:text-foreground"
        onclick={addArrayItem}
      >Add</button>
    </div>
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'array-enum'}
  {@const items = Array.isArray(schema.items) ? schema.items[0] : schema.items}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    {#if items?.enum}
      <div class="flex flex-wrap gap-2">
        {#each items.enum as option}
          <label class="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              class="accent-accent"
              checked={isChecked(option)}
              onchange={() => toggleMultiEnum(option)}
            />
            {String(option)}
          </label>
        {/each}
      </div>
    {/if}
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'record'}
  {@const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : []}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <div class="space-y-1.5">
      {#each entries as [key, val]}
        <div class="flex gap-1.5 items-center">
          <span class="text-xs text-muted-foreground font-mono min-w-[80px] shrink-0">{key}</span>
          <input
            class={inputClass}
            type="text"
            value={String(val ?? '')}
            oninput={(e) => onRecordValueInput(key, e)}
          />
          <button
            type="button"
            class="bg-transparent border-none text-muted-foreground cursor-pointer text-xs p-1 hover:text-destructive shrink-0"
            onclick={() => removeRecordEntry(key)}
          >&times;</button>
        </div>
      {/each}
    </div>
    <div class="flex gap-1.5 mt-1">
      <input
        class={inputClass}
        type="text"
        bind:value={newRecordKey}
        placeholder="New key…"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecordEntry(); } }}
      />
      <button
        type="button"
        class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-xs py-[5px] px-2 shrink-0 transition-colors hover:text-foreground"
        onclick={addRecordEntry}
      >Add</button>
    </div>
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else if fieldType === 'array-object'}
  {@const items = Array.isArray(schema.items) ? schema.items[0] : schema.items}
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label} ({Array.isArray(value) ? (value as unknown[]).length : 0} items)</label>
    {#each (Array.isArray(value) ? value as unknown[] : []) as item, i}
      <div class="border border-border rounded-lg p-3 space-y-3 relative">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] text-muted-foreground font-mono">#{i}</span>
          <button
            type="button"
            class="bg-transparent border-none text-muted-foreground cursor-pointer text-xs hover:text-destructive"
            onclick={() => removeArrayObject(i)}
          >Remove</button>
        </div>
        {#if items?.properties}
          {#each Object.entries(items.properties) as [key, propSchema] (key)}
            {@const childPath = `${path}.${i}.${key}`}
            {@const childHint = configState.uiHints[childPath] ?? configState.uiHints[`${path}[].${key}`] ?? configState.uiHints[`${path}.*.${key}`] ?? {}}
            {@const childValue = item != null && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined}
            <ConfigField
              path={childPath}
              schema={propSchema}
              hint={childHint}
              value={childValue}
              depth={depth + 1}
            />
          {/each}
        {:else}
          <ConfigJsonEditor {path} pathSuffix=".{i}" value={item} />
        {/if}
      </div>
    {/each}
    <button
      type="button"
      class="bg-transparent border border-dashed border-border rounded-[5px] text-muted-foreground cursor-pointer text-xs py-[6px] px-3 transition-colors hover:border-accent hover:text-foreground w-full"
      onclick={addArrayObject}
    >+ Add Item</button>
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>

{:else}
  <!-- json fallback -->
  <div class="flex flex-col gap-1">
    <label class={labelClass}>{label}</label>
    <ConfigJsonEditor {path} {value} />
    {#if helpText}<p class="text-[10px] text-muted-foreground">{helpText}</p>{/if}
  </div>
{/if}
