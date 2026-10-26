<script lang="ts">
  import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, Input, Select, Toggle } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import {
    configSchema,
    FORM_FIELD_TYPES,
    FORM_MAX_FIELDS,
    type FormField as FormFieldDef,
    type FormFieldType,
  } from '$lib/doors/kinds/form';
  import type { DoorEditorProps } from '$lib/doors/types';

  let { config, onchange, canManage }: DoorEditorProps = $props();

  type Editable = {
    fields: FormFieldDef[];
    consentText: string;
    consentRequired: boolean;
    successMessage?: string;
  };

  // Controlled: the page owns the draft; a malformed stored config still opens.
  const cfg = $derived.by((): Editable => {
    const c = (config ?? {}) as Partial<Editable>;
    return {
      fields: Array.isArray(c.fields) ? c.fields : [],
      consentText: typeof c.consentText === 'string' ? c.consentText : '',
      consentRequired: c.consentRequired !== false,
      ...(c.successMessage ? { successMessage: c.successMessage } : {}),
    };
  });

  function emit(next: Partial<Editable>) {
    const out: Editable = { ...cfg, ...next };
    if (!out.successMessage?.trim()) delete out.successMessage;
    onchange(out);
  }

  const typeLabel: Record<FormFieldType, () => string> = {
    text: m.doors_form_type_text,
    textarea: m.doors_form_type_textarea,
    phone: m.doors_form_type_phone,
    email: m.doors_form_type_email,
    select: m.doors_form_type_select,
    date: m.doors_form_type_date,
    checkbox: m.doors_form_type_checkbox,
  };
  const typeOptions = $derived(FORM_FIELD_TYPES.map((t) => ({ value: t, label: typeLabel[t]() })));

  // Keys of fields added in this session follow their label; saved keys never
  // change, so earlier submissions stay readable.
  let fresh = $state<string[]>([]);

  function slugKey(label: string): string {
    const base = label
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 34);
    return /^[a-z]/.test(base) ? base : `campo${base ? `_${base}` : ''}`.slice(0, 34);
  }

  function uniqueKey(base: string, skip = -1): string {
    const taken = new Set(cfg.fields.filter((_, i) => i !== skip).map((f) => f.key));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  }

  function updateField(i: number, patch: Partial<FormFieldDef>) {
    emit({ fields: cfg.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  }

  function setLabel(i: number, label: string) {
    const field = cfg.fields[i];
    if (!fresh.includes(field.key)) return updateField(i, { label });
    const key = uniqueKey(slugKey(label), i);
    fresh = fresh.map((k) => (k === field.key ? key : k));
    updateField(i, { label, key });
  }

  function setType(i: number, type: FormFieldType) {
    const { options: _, ...rest } = cfg.fields[i];
    const next: FormFieldDef =
      type === 'select'
        ? { ...rest, type, options: cfg.fields[i].options ?? [] }
        : { ...rest, type };
    emit({ fields: cfg.fields.map((f, j) => (j === i ? next : f)) });
  }

  function move(i: number, dir: -1 | 1) {
    const fields = [...cfg.fields];
    [fields[i], fields[i + dir]] = [fields[i + dir], fields[i]];
    emit({ fields });
  }

  function add() {
    const key = uniqueKey('campo');
    fresh = [...fresh, key];
    emit({ fields: [...cfg.fields, { key, label: '', type: 'text', required: false }] });
  }

  const problems = $derived.by(() => {
    const r = configSchema.safeParse(cfg);
    if (r.success) return [];
    const out = new Set<string>();
    for (const issue of r.error.issues) {
      if (issue.message === 'needs_contact_field') out.add(m.doors_form_problem_contact());
      else if (issue.message === 'select_needs_options') out.add(m.doors_form_problem_select());
      else if (issue.path[0] === 'fields' && issue.path[2] === 'label')
        out.add(m.doors_form_problem_label());
      else if (issue.path[0] === 'consentText') out.add(m.doors_form_problem_consent());
    }
    return [...out];
  });

  const name = (f: FormFieldDef) => f.label.trim() || m.doors_form_untitled();
</script>

<div class="form-editor">
  <div class="card-h">
    <span>{m.doors_form_fields_title()}</span>
    <span class="t-caption">{m.doors_form_max_fields({ max: FORM_MAX_FIELDS })}</span>
  </div>

  {#if problems.length}
    <ul class="problems" role="status">
      {#each problems as p (p)}<li>{p}</li>{/each}
    </ul>
  {/if}

  <ol class="fields">
    {#each cfg.fields as field, i (i)}
      <li class="field-row">
        <div class="row-main">
          <Input
            label={m.doors_form_field_label()}
            value={field.label}
            maxlength={200}
            size="sm"
            disabled={!canManage}
            oninput={(e: Event) => setLabel(i, (e.currentTarget as HTMLInputElement).value)}
          />
          <Select
            label={m.doors_form_field_type()}
            value={field.type}
            options={typeOptions}
            size="sm"
            disabled={!canManage}
            onchange={(v) => setType(i, v as FormFieldType)}
          />
        </div>
        {#if field.type === 'select'}
          <FormField label={m.doors_form_field_options()} disabled={!canManage}>
            {#snippet children(p)}
              <textarea
                {...p}
                class="ctl"
                rows={3}
                value={(field.options ?? []).join('\n')}
                onchange={(e) =>
                  updateField(i, {
                    options: e.currentTarget.value
                      .split('\n')
                      .map((o) => o.trim())
                      .filter(Boolean)
                      .slice(0, 20),
                  })}></textarea>
            {/snippet}
          </FormField>
        {/if}
        <div class="row-actions">
          <Toggle
            size="sm"
            checked={field.required}
            disabled={!canManage}
            label={m.doors_form_field_required()}
            onchange={(required) => updateField(i, { required })}
          />
          <span class="spacer"></span>
          <Button
            variant="ghost"
            shape="icon"
            size="xs"
            disabled={!canManage || i === 0}
            onclick={() => move(i, -1)}
            aria-label={m.doors_form_move_up({ label: name(field) })}
          >
            <ArrowUp size={iconSizes.sm} />
          </Button>
          <Button
            variant="ghost"
            shape="icon"
            size="xs"
            disabled={!canManage || i === cfg.fields.length - 1}
            onclick={() => move(i, 1)}
            aria-label={m.doors_form_move_down({ label: name(field) })}
          >
            <ArrowDown size={iconSizes.sm} />
          </Button>
          <Button
            variant="ghost"
            shape="icon"
            size="xs"
            disabled={!canManage || cfg.fields.length <= 1}
            onclick={() => emit({ fields: cfg.fields.filter((_, j) => j !== i) })}
            aria-label={m.doors_form_remove({ label: name(field) })}
          >
            <Trash2 size={iconSizes.sm} />
          </Button>
        </div>
      </li>
    {/each}
  </ol>

  {#if canManage}
    <div>
      <Button
        variant="secondary"
        size="sm"
        disabled={cfg.fields.length >= FORM_MAX_FIELDS}
        onclick={add}
      >
        <Plus size={iconSizes.sm} />{m.doors_form_add_field()}
      </Button>
    </div>
  {/if}

  <FormField
    label={m.doors_form_consent_text()}
    helper={m.doors_form_consent_hint()}
    required
    disabled={!canManage}
  >
    {#snippet children(p)}
      <textarea
        {...p}
        class="ctl"
        rows={3}
        maxlength={1000}
        value={cfg.consentText}
        oninput={(e) => emit({ consentText: e.currentTarget.value })}></textarea>
    {/snippet}
  </FormField>
  <Toggle
    checked={cfg.consentRequired}
    disabled={!canManage}
    label={m.doors_form_consent_required()}
    onchange={(consentRequired) => emit({ consentRequired })}
  />
  <Input
    label={m.doors_form_success_message()}
    helper={m.doors_form_success_hint()}
    value={cfg.successMessage ?? ''}
    maxlength={500}
    disabled={!canManage}
    oninput={(e: Event) => emit({ successMessage: (e.currentTarget as HTMLInputElement).value })}
  />
</div>

<style>
  .form-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .card-h {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    text-transform: uppercase;
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  .card-h .t-caption {
    text-transform: none;
    font-weight: 400;
    letter-spacing: normal;
    color: var(--color-text-tertiary);
  }
  .problems {
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-6);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
    font-size: var(--font-size-caption);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .field-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-card-compact);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .row-main {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-2);
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .spacer {
    flex: 1;
  }
  .ctl {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    resize: vertical;
  }
  @media (max-width: 640px) {
    .row-main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
