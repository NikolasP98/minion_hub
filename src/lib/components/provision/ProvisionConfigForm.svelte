<script lang="ts">
    import { provisionState, saveConfig } from "$lib/state/features/provision.svelte";
    import { Server, Bot, Package, Radio, Key, Save, Loader2 } from "lucide-svelte";

    interface Props {
        serverId: string;
    }

    let { serverId }: Props = $props();

    let saving = $state(false);

    async function handleSave() {
        saving = true;
        await saveConfig(serverId);
        saving = false;
    }
</script>

<div class="space-y-4">
    <!-- Connection -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Server size={12} class="text-muted-foreground/70" />
            SSH Connection
        </h3>
        <div class="space-y-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="ssh-host">Host</label>
                <input
                    id="ssh-host"
                    type="text"
                    bind:value={provisionState.config.sshHost}
                    placeholder="192.168.1.100 or hostname"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div class="grid grid-cols-2 gap-2.5">
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="ssh-user">User</label>
                    <input
                        id="ssh-user"
                        type="text"
                        bind:value={provisionState.config.sshUser}
                        placeholder="root"
                        class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                </div>
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="ssh-port">Port</label>
                    <input
                        id="ssh-port"
                        type="number"
                        bind:value={provisionState.config.sshPort}
                        placeholder="22"
                        class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                </div>
            </div>
        </div>
    </div>

    <!-- Agent -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Bot size={12} class="text-muted-foreground/70" />
            Agent
        </h3>
        <div class="space-y-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="agent-name">Name</label>
                <input
                    id="agent-name"
                    type="text"
                    bind:value={provisionState.config.agentName}
                    placeholder="minion"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div class="grid grid-cols-2 gap-2.5">
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="sandbox-mode">Sandbox Mode</label>
                    <select
                        id="sandbox-mode"
                        bind:value={provisionState.config.sandboxMode}
                        class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                        <option value="non-main">Non-main</option>
                        <option value="always">Always</option>
                        <option value="never">Never</option>
                    </select>
                </div>
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="dm-policy">DM Policy</label>
                    <select
                        id="dm-policy"
                        bind:value={provisionState.config.dmPolicy}
                        class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                        <option value="pairing">Pairing</option>
                        <option value="solo">Solo</option>
                        <option value="disabled">Disabled</option>
                    </select>
                </div>
            </div>
        </div>
    </div>

    <!-- Install -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Package size={12} class="text-muted-foreground/70" />
            Install
        </h3>
        <div class="grid grid-cols-2 gap-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="install-method">Method</label>
                <select
                    id="install-method"
                    bind:value={provisionState.config.installMethod}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                >
                    <option value="package">Package</option>
                    <option value="source">Source</option>
                </select>
            </div>
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="pkg-manager">Package Manager</label>
                <select
                    id="pkg-manager"
                    bind:value={provisionState.config.pkgManager}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                >
                    <option value="npm">npm</option>
                    <option value="bun">bun</option>
                </select>
            </div>
        </div>
    </div>

    <!-- Gateway -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Radio size={12} class="text-muted-foreground/70" />
            Gateway
        </h3>
        <div class="grid grid-cols-2 gap-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="gw-port">Port</label>
                <input
                    id="gw-port"
                    type="number"
                    bind:value={provisionState.config.gatewayPort}
                    placeholder="18789"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="gw-bind">Bind</label>
                <select
                    id="gw-bind"
                    bind:value={provisionState.config.gatewayBind}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                >
                    <option value="loopback">Loopback (127.0.0.1)</option>
                    <option value="all">All interfaces (0.0.0.0)</option>
                </select>
            </div>
        </div>
    </div>

    <!-- Channels -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">
            Channels
        </h3>
        <div class="space-y-2">
            <label class="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" bind:checked={provisionState.config.enableWhatsapp} class="accent-accent" />
                <span class="text-sm text-foreground">WhatsApp</span>
            </label>
            <label class="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" bind:checked={provisionState.config.enableTelegram} class="accent-accent" />
                <span class="text-sm text-foreground">Telegram</span>
            </label>
            <label class="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" bind:checked={provisionState.config.enableDiscord} class="accent-accent" />
                <span class="text-sm text-foreground">Discord</span>
            </label>
        </div>
    </div>

    <!-- Credentials -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Key size={12} class="text-muted-foreground/70" />
            Credentials
        </h3>
        <div>
            <label class="text-xs text-muted-foreground mb-1 block" for="api-key">Anthropic API Key</label>
            <input
                id="api-key"
                type="password"
                bind:value={provisionState.config.apiKey}
                placeholder="sk-ant-..."
                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p class="text-[10px] text-muted-foreground/60 mt-1">
                Stored encrypted. Leave blank to keep existing key.
            </p>
        </div>
    </div>

    <!-- Save button -->
    <button
        type="button"
        class="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-accent text-accent-foreground border-none cursor-pointer transition-colors hover:opacity-90 disabled:opacity-50 w-full justify-center"
        disabled={saving || provisionState.running}
        onclick={handleSave}
    >
        {#if saving}
            <Loader2 size={14} class="animate-spin" />
            Saving...
        {:else}
            <Save size={14} />
            Save Configuration
        {/if}
    </button>
</div>
