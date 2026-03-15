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
        background: var(--color-bg2, #1a1a2e);
        border: 2px solid var(--color-warning, #f59e0b);
        border-radius: 8px;
        padding: 10px 16px;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 4px;
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
        background: var(--color-warning, #f59e0b);
        border-radius: 6px 6px 0 0;
    }

    .diamond-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-warning, #f59e0b);
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }

    .diamond-question {
        font-size: 12px;
        color: var(--color-foreground, #e0e0e0);
        font-style: italic;
        line-height: 1.3;
        max-width: 180px;
    }

    .handle-row {
        display: flex;
        gap: 24px;
        margin-top: 4px;
    }

    .handle-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
    }

    .handle-label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .handle-wrap.yes .handle-label {
        color: var(--color-success, #22c55e);
    }

    .handle-wrap.no .handle-label {
        color: var(--color-error, #ef4444);
    }
</style>
