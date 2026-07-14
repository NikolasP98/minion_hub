<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { Phone, PhoneOff, Mic, MicOff, Globe, Check } from 'lucide-svelte';
  import type { AgentVoiceState } from '$lib/voice/visemeMap';
  import { Dropdown } from '$lib/components/ui';
  import type { DropdownItem } from '$lib/components/ui';
  import {
    txPrefs,
    setNoteLang,
    NOTE_LANGS,
    type NoteLang,
  } from '$lib/state/features/transcription-prefs.svelte';

  interface Props {
    active: boolean;
    muted: boolean;
    status: AgentVoiceState;
    disabled?: boolean;
    onstart: () => void;
    onend: () => void;
    ontoggleMute: () => void;
  }

  const { active, muted, status, disabled = false, onstart, onend, ontoggleMute }: Props = $props();

  const STATUS_LABEL: Record<AgentVoiceState, string> = {
    idle: m.call_muted(),
    listening: m.call_listening(),
    thinking: m.call_thinking(),
    speaking: m.call_speaking(),
  };

  // Speech-recognition + synthesis language — the shared transcription pref
  // (same one the note editor uses), surfaced as the standard ui Dropdown.
  const LANG_LABEL: Record<NoteLang, () => string> = {
    auto: m.note_langAuto,
    es: m.note_langEs,
    en: m.note_langEn,
  };
  const langItems = $derived<DropdownItem[]>(
    NOTE_LANGS.map((l) => ({
      value: l,
      label: LANG_LABEL[l](),
    })),
  );
  const langBadge = $derived(txPrefs.lang === 'auto' ? 'A' : txPrefs.lang.toUpperCase());
</script>

<div class="call-cluster">
  <Dropdown items={langItems} onSelect={(v) => setNoteLang(v as NoteLang)} placement="top">
    {#snippet trigger()}
      <span class="lang-pill" title={m.settings_language()} aria-label={m.settings_language()}>
        <Globe size={14} />
        <span class="lang-code">{langBadge}</span>
      </span>
    {/snippet}
    {#snippet item({ item })}
      <span class="flex-1">{item.label}</span>
      {#if txPrefs.lang === item.value}
        <Check size={14} class="text-muted-foreground" />
      {/if}
    {/snippet}
  </Dropdown>

  {#if !active}
    <Button
      type="button"
      class="call-btn start"
      {disabled}
      onclick={onstart}
      aria-label={m.call_callYourAgent()}
      title={disabled ? m.call_connectGatewayFirst() : m.call_callYourAgent()}
    >
      <Phone size={16} />
    </Button>
  {:else}
    <div class="call-live" role="group" aria-label={m.call_callControls()}>
      <span class="status" data-status={status}>
        <span class="pulse" class:on={status === 'listening' || status === 'speaking'}></span>
        {STATUS_LABEL[status]}
      </span>
      <Button
        type="button"
        class="icon-btn {muted ? 'muted' : ''}"
        onclick={ontoggleMute}
        title={muted ? m.call_unmute() : m.call_mute()}
        aria-pressed={muted}
      >
        {#if muted}<MicOff size={14} />{:else}<Mic size={14} />{/if}
      </Button>
      <Button type="button" class="icon-btn end" onclick={onend} title={m.call_endCall()}>
        <PhoneOff size={14} />
      </Button>
    </div>
  {/if}
</div>

<style>
  .call-cluster {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Transcription-language trigger — quiet pill matching the call button height. */
  .lang-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 40px;
    padding: 0 9px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
    cursor: pointer;
    transition:
      color var(--duration-fast) ease,
      border-color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .lang-pill:hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
  .lang-code {
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.04em;
  }

  :global(.call-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Icon-only, compact square — matches the chat input box height + radius. */
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: var(--radius-lg);
    font-size: var(--font-size-caption);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
    transition:
      background var(--duration-fast) ease,
      border-color var(--duration-fast) ease;
  }
  :global(.call-btn):hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
  }
  :global(.call-btn):disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  :global(.call-btn):focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .call-live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pulse {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-foreground) 30%, transparent);
  }
  .pulse.on {
    background: var(--color-success);
    box-shadow: var(--shadow-elevation-2);
    animation: pulse 1.4s infinite;
  }

  :global(.icon-btn) {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    cursor: pointer;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    color: var(--color-foreground);
    transition: background var(--duration-fast) ease;
  }
  :global(.icon-btn):hover {
    background: color-mix(in srgb, var(--color-foreground) 10%, transparent);
  }
  :global(.icon-btn):global(.muted) {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  :global(.icon-btn):global(.end) {
    color: var(--color-brand);
    border-color: color-mix(in srgb, var(--color-brand) 40%, transparent);
    background: color-mix(in srgb, var(--color-brand) 10%, transparent);
  }
  :global(.icon-btn):global(.end):hover {
    background: color-mix(in srgb, var(--color-brand) 20%, transparent);
  }

  @keyframes pulse {
    0% {
      box-shadow: var(--shadow-elevation-2);
    }
    70% {
      box-shadow: var(--shadow-elevation-2);
    }
    100% {
      box-shadow: var(--shadow-elevation-2);
    }
  }
</style>
