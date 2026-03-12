---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/config/ConfigField.svelte
autonomous: true
requirements: [BUG-OBJECT-OBJECT]

must_haves:
  truths:
    - "Record fields with nested object values render as editable sub-fields or JSON editor, not as '[object Object]' text"
    - "Record fields with simple string values continue to render as inline text inputs"
    - "Adding a new record entry still works correctly"
    - "Deleting a record entry still works correctly"
  artifacts:
    - path: "src/lib/components/config/ConfigField.svelte"
      provides: "Record field rendering with nested object support"
      contains: "typeof val === 'object'"
  key_links:
    - from: "ConfigField.svelte record branch"
      to: "ConfigField.svelte (recursive) or ConfigJsonEditor.svelte"
      via: "conditional rendering based on value type"
      pattern: "typeof val.*object"
---

<objective>
Fix config editor rendering "[object Object]" as literal text for record fields whose values are nested objects (e.g., MODELS > providers > openrouter).

Purpose: The `record` field type in ConfigField.svelte uses `String(val ?? "")` on line 548 to display values in text inputs. When a record's values are objects (not strings), `String({...})` produces "[object Object]". This is the case for config keys like `models.providers` where each provider key maps to an object with sub-properties.

Output: ConfigField.svelte with proper handling for object-typed record values.
</objective>

<execution_context>
@/home/nikolas/.claude/get-shit-done/workflows/execute-plan.md
@/home/nikolas/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/lib/components/config/ConfigField.svelte
@src/lib/components/config/ConfigJsonEditor.svelte
@src/lib/utils/config-schema.ts
@src/lib/types/config.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/lib/types/config.ts:
```typescript
export type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  // ... other fields
};

export type FieldType =
  | 'string' | 'number' | 'boolean' | 'enum' | 'multi-enum'
  | 'select' | 'sensitive' | 'object' | 'record'
  | 'array-string' | 'array-object' | 'array-enum' | 'json';
```

From src/lib/utils/config-schema.ts:
```typescript
// record type is resolved when: type === 'object' && !properties && additionalProperties
export function resolveFieldType(schema: JsonSchemaNode, hint?: ConfigUiHint): FieldType {
  // ...
  if (type === 'object') {
    if (schema.properties && Object.keys(schema.properties).length > 0) return 'object';
    if (schema.additionalProperties) return 'record';
    return 'json';
  }
}
```

Key insight: `schema.additionalProperties` can be `true` (any type) or a `JsonSchemaNode`
(typed values). When it's a JsonSchemaNode with type 'object' and properties, the record
values are nested objects that need recursive rendering.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix record field rendering to handle nested object values</name>
  <files>src/lib/components/config/ConfigField.svelte</files>
  <action>
In the `{:else if fieldType === "record"}` branch (around line 531), the current code renders every record value as a text input with `value={String(val ?? "")}`. This must be changed to handle three cases:

1. **Object values with a typed additionalProperties schema** -- When `schema.additionalProperties` is a `JsonSchemaNode` (not just `true`), and the value is an object: render a recursive `<ConfigField>` for each entry using the additionalProperties schema as the child schema, and `${path}.${key}` as the child path.

2. **Object values without typed schema** (additionalProperties is `true` or value is object but schema doesn't describe it) -- Render `<ConfigJsonEditor>` for each entry so the user gets a JSON textarea.

3. **Primitive values** (string, number, etc.) -- Keep the existing inline text input behavior with `String(val ?? "")`.

Specifically, replace the `{#each entries as [key, val]}` block inside the record branch. The new logic for each entry should be:

```svelte
{#each entries as [key, val]}
  <div class="flex flex-col gap-1.5">
    <div class="flex gap-1.5 items-center">
      <span class="text-xs text-muted-foreground font-mono min-w-20 shrink-0">{key}</span>
      <span class="flex-1"></span>
      <button type="button" class="bg-transparent border-none text-muted-foreground cursor-pointer text-xs p-1 hover:text-destructive shrink-0" onclick={() => removeRecordEntry(key)}>&times;</button>
    </div>
    {#if val != null && typeof val === 'object' && !Array.isArray(val)}
      {#if typeof schema.additionalProperties === 'object' && schema.additionalProperties.properties}
        <!-- Typed nested object: render recursively -->
        <div class="pl-3 border-l border-border">
          <ConfigField
            path={`${path}.${key}`}
            schema={schema.additionalProperties}
            hint={configState.uiHints[`${path}.${key}`] ?? {}}
            value={val}
            depth={depth + 1}
          />
        </div>
      {:else}
        <!-- Untyped object: JSON editor -->
        <div class="pl-3 border-l border-border">
          <ConfigJsonEditor path={path} pathSuffix=".{key}" value={val} />
        </div>
      {/if}
    {:else}
      <!-- Primitive value: inline text input -->
      <input
        class={inputClass}
        type="text"
        value={String(val ?? "")}
        oninput={(e) => onRecordValueInput(key, e)}
      />
    {/if}
  </div>
{/each}
```

Key details:
- The `configState` import is already present at line 10.
- The `ConfigJsonEditor` import is already present at line 11.
- The recursive `ConfigField` import (self-reference) is already present at line 12.
- Keep all existing record helper functions (addRecordEntry, removeRecordEntry, onRecordValueInput) unchanged.
- For the primitive branch, the delete button stays on the same row as the key label and input (horizontal layout). For object branches, the delete button is on the key label row and the nested content is below with left border indent, matching the existing sub-group visual pattern used in the object fieldType branch.
  </action>
  <verify>
    <automated>cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | tail -20</automated>
  </verify>
  <done>
- Record entries with object values render as recursive ConfigField (when schema.additionalProperties has properties) or ConfigJsonEditor (when untyped), not "[object Object]"
- Record entries with primitive values still render as inline text inputs
- No type errors from svelte-check
  </done>
</task>

</tasks>

<verification>
- `bun run check` passes with no type errors in ConfigField.svelte
- Visual: navigate to Settings > AI > Models, expand the providers section -- object values should render as nested fields or JSON editor, not "[object Object]"
</verification>

<success_criteria>
- No "[object Object]" text appears anywhere in the config editor for record-type fields
- Nested object values are editable (either via recursive fields or JSON editor)
- Simple string record values continue working as inline text inputs
- Type-check passes
</success_criteria>

<output>
After completion, create `.planning/quick/1-fix-settings-rendering-object-object-tex/1-SUMMARY.md`
</output>
