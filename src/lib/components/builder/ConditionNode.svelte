<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';

    interface Props {
        data: { label: string; conditionText: string };
    }

    let { data }: Props = $props();
</script>

<div class="condition-node">
    <Handle type="target" position={Position.Top} />

    <div class="diamond">
        <span class="diamond-label">{data.label}</span>
        {#if data.conditionText}
            <span class="diamond-question">{data.conditionText}</span>
        {/if}
    </div>

    <div class="handle-row">
        <div class="handle-wrap yes">
            <Handle type="source" position={Position.Bottom} id="yes" style="position: relative; left: 0; transform: none;" />
            <span class="handle-label">Yes</span>
        </div>
        <div class="handle-wrap no">
            <Handle type="source" position={Position.Bottom} id="no" style="position: relative; left: 0; transform: none;" />
            <span class="handle-label">No</span>
        </div>
    </div>
</div>

<style>
    .condition-node {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 140px;
    }

    .diamond {
        background: var(--color-bg2, var(--color-surface-2));
        border: 2px solid var(--color-warning, var(--color-warning-fg));
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-4);
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        transform: none;
        position: relative;
    }

    .diamond::before {
        content: '';
        position: absolute;
        top: -1px;
        left: -1px;
        right: -1px;
        height: 3px;
        background: var(--color-warning, var(--color-warning-fg));
        border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    .diamond-label {
        font-size: var(--font-size-caption);
        font-weight: 700;
        color: var(--color-warning, var(--color-warning-fg));
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }

    .diamond-question {
        font-size: var(--font-size-caption);
        color: var(--color-foreground, var(--color-text-secondary));
        font-style: italic;
        line-height: 1.3;
        max-width: 180px;
    }

    .handle-row {
        display: flex;
        gap: var(--space-6);
        margin-top: var(--space-1);
    }

    .handle-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-0-5);
    }

    .handle-label {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .handle-wrap.yes .handle-label {
        color: var(--color-success, var(--color-success-fg));
    }

    .handle-wrap.no .handle-label {
        color: var(--color-danger-fg);
    }
</style>
