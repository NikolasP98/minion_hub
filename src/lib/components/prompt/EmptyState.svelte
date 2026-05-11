<script lang="ts">
    import AgentSelector from "./AgentSelector.svelte";
</script>

<div class="flex-1 flex items-center justify-center p-8">
    <div class="max-w-md text-center space-y-4">
        <h2 class="text-lg font-semibold">Select an agent to manage prompt sections</h2>
        <p class="text-sm text-muted">
            Choose an agent from the picker below to view, edit, and toggle its prompt
            section layers.
        </p>
        <div class="flex justify-center pt-2">
            <AgentSelector />
        </div>
    </div>
</div>
