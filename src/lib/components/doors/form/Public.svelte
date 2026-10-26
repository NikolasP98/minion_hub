<script lang="ts">
  import { Check, CircleCheck } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, Input, Select } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import {
    validateSubmission,
    type FieldErrorCode,
    type FormField as FormFieldDef,
    type FormPublicData,
  } from '$lib/doors/kinds/form';
  import type { DoorPublicProps } from '$lib/doors/types';

  let { door, data, attribution }: DoorPublicProps = $props();
  const uid = $props.id();

  const form = $derived(data as FormPublicData);

  let values = $state<Record<string, string | boolean>>({});
  let consent = $state(false);
  // Honeypot: hidden from people and assistive tech; only bots fill it.
  let website = $state('');
  let errors = $state<Record<string, FieldErrorCode>>({});
  let formError = $state<string | null>(null);
  let sending = $state(false);
  let sent = $state<string | null>(null);

  const text = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : '');

  function fieldError(field: FormFieldDef): string | undefined {
    const code = errors[field.key];
    if (!code) return undefined;
    if (code === 'required') return m.doors_form_err_required();
    if (field.type === 'email') return m.doors_form_err_email();
    if (field.type === 'phone') return m.doors_form_err_phone();
    return m.doors_form_err_invalid();
  }

  function set(key: string, value: string | boolean) {
    values[key] = value;
    if (errors[key]) delete errors[key];
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (sending) return;
    formError = null;
    const checked = validateSubmission(form, values, consent);
    if (!checked.ok) {
      errors = checked.errors;
      formError = m.doors_form_err_fix();
      return;
    }
    errors = {};
    sending = true;
    try {
      const res = await fetch(`/api/doors/public/${encodeURIComponent(door.slug)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values, consent, website, attribution }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string | null;
        fields?: Record<string, FieldErrorCode>;
      };
      if (res.ok) {
        sent = body.message || m.doors_form_sent();
      } else if (res.status === 400 && body.fields) {
        errors = body.fields;
        formError = m.doors_form_err_fix();
      } else {
        formError =
          res.status === 429
            ? m.doors_form_err_rate()
            : res.status === 404
              ? m.doors_form_err_gone()
              : m.doors_form_err_send();
      }
    } catch {
      formError = m.doors_form_err_send();
    } finally {
      sending = false;
    }
  }
</script>

{#if sent}
  <div class="sent" role="status">
    <CircleCheck size={iconSizes.lg} />
    <p class="t-body">{sent}</p>
  </div>
{:else}
  <form class="door-form" novalidate onsubmit={submit}>
    {#each form.fields as field (field.key)}
      {#if field.type === 'text' || field.type === 'phone' || field.type === 'email'}
        <Input
          label={field.label}
          value={text(field.key)}
          oninput={(e: Event) => set(field.key, (e.currentTarget as HTMLInputElement).value)}
          type={field.type === 'phone' ? 'tel' : field.type}
          autocomplete={field.type === 'phone'
            ? 'tel'
            : field.type === 'email'
              ? 'email'
              : /^(name|nombre)$/.test(field.key)
                ? 'name'
                : 'off'}
          inputmode={field.type === 'phone' ? 'tel' : undefined}
          maxlength={2000}
          size="touch"
          required={field.required}
          error={fieldError(field)}
        />
      {:else if field.type === 'select'}
        <Select
          label={field.label}
          value={text(field.key)}
          options={[
            { value: '', label: m.doors_form_select_placeholder() },
            ...(field.options ?? []).map((o) => ({ value: o, label: o })),
          ]}
          size="md"
          required={field.required}
          error={fieldError(field)}
          onchange={(v) => set(field.key, String(v ?? ''))}
        />
      {:else if field.type === 'checkbox'}
        <div class="check-field">
          <label class="check">
            <input
              type="checkbox"
              checked={values[field.key] === true}
              aria-invalid={errors[field.key] ? 'true' : undefined}
              aria-describedby={errors[field.key] ? `${uid}-${field.key}-err` : undefined}
              onchange={(e) => set(field.key, e.currentTarget.checked)}
            />
            <span class="t-body"
              >{field.label}{#if field.required}<span class="req" aria-hidden="true">*</span
                >{/if}</span
            >
          </label>
          {#if fieldError(field)}<p id={`${uid}-${field.key}-err`} class="field-error" role="alert">
              {fieldError(field)}
            </p>{/if}
        </div>
      {:else}
        <FormField label={field.label} required={field.required} error={fieldError(field)}>
          {#snippet children(p)}
            {#if field.type === 'textarea'}
              <textarea
                {...p}
                class="ctl area"
                rows={4}
                maxlength={2000}
                value={text(field.key)}
                oninput={(e) => set(field.key, e.currentTarget.value)}></textarea>
            {:else}
              <input
                {...p}
                class="ctl"
                type="date"
                value={text(field.key)}
                oninput={(e) => set(field.key, e.currentTarget.value)}
              />
            {/if}
          {/snippet}
        </FormField>
      {/if}
    {/each}

    <div class="hp" aria-hidden="true">
      <label>
        {m.doors_form_honeypot()}
        <input type="text" name="website" tabindex="-1" autocomplete="off" bind:value={website} />
      </label>
    </div>

    <div class="check-field">
      <label class="check consent">
        <input
          type="checkbox"
          bind:checked={consent}
          aria-invalid={errors.consent ? 'true' : undefined}
          aria-describedby={errors.consent ? `${uid}-consent-err` : undefined}
          onchange={() => delete errors.consent}
        />
        <span class="t-body"
          >{form.consentText}{#if form.consentRequired}<span class="req" aria-hidden="true">*</span
            >{/if}</span
        >
      </label>
      {#if errors.consent}<p id={`${uid}-consent-err`} class="field-error" role="alert">
          {m.doors_form_err_consent()}
        </p>{/if}
    </div>

    {#if formError}
      <p class="form-error" role="alert">{formError}</p>
    {/if}

    <Button type="submit" variant="primary" size="touch" loading={sending}>
      <Check size={iconSizes.md} />{m.doors_form_submit()}
    </Button>
  </form>
{/if}

<style>
  .door-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .ctl {
    width: 100%;
    min-height: var(--control-height-touch);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
  }
  .area {
    resize: vertical;
  }
  .ctl[aria-invalid='true'],
  .check input[aria-invalid='true'] {
    border-color: var(--color-danger-border);
    outline-color: var(--color-danger-border);
  }
  .check-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .check input {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    margin-top: var(--space-0-5);
    accent-color: var(--color-accent);
  }
  .consent {
    color: var(--color-text-secondary);
  }
  .req {
    margin-left: var(--space-0-5);
    color: var(--color-danger-fg);
  }
  .field-error,
  .form-error {
    margin: 0;
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption);
  }
  .form-error {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    background: var(--color-danger-surface);
  }
  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .sent {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) 0;
    text-align: center;
    color: var(--color-success-fg);
  }
  .sent p {
    margin: 0;
    color: var(--color-text-primary);
  }
</style>
