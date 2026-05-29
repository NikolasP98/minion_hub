<script lang="ts">
    import { provisionState, saveConfig } from "$lib/state/features/provision.svelte";
    import { Server, Bot, Package, Radio, Key, Save, Loader2 } from "lucide-svelte";
    import { Select } from '$lib/components/ui';
    import * as m from '$lib/paraglide/messages';

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
            <Server size={12} class="text-muted-strong" />
            {m.provision_sshConnection()}
        </h3>
        <div class="space-y-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="ssh-host">{m.provision_host()}</label>
                <input
                    id="ssh-host"
                    type="text"
                    bind:value={provisionState.config.sshHost}
                    placeholder={m.provision_hostPlaceholder()}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div class="grid grid-cols-2 gap-2.5">
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="ssh-user">{m.provision_user()}</label>
                    <input
                        id="ssh-user"
                        type="text"
                        bind:value={provisionState.config.sshUser}
                        placeholder="root"
                        class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                </div>
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="ssh-port">{m.provision_port()}</label>
                    <input
                        id="ssh-port"
                        type="number"
                        bind:value={provisionState.config.sshPort}
                        placeholder="22"
                        class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                </div>
            </div>
        </div>
    </div>

    <!-- Agent -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Bot size={12} class="text-muted-strong" />
            {m.provision_agent()}
        </h3>
        <div class="space-y-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="agent-name">{m.provision_name()}</label>
                <input
                    id="agent-name"
                    type="text"
                    bind:value={provisionState.config.agentName}
                    placeholder="minion"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div class="grid grid-cols-2 gap-2.5">
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="sandbox-mode">{m.provision_sandboxMode()}</label>
                    <Select id="sandbox-mode" bind:value={provisionState.config.sandboxMode} size="md">
                        <option value="non-main">{m.provision_sandboxNonMain()}</option>
                        <option value="always">{m.provision_sandboxAlways()}</option>
                        <option value="never">{m.provision_sandboxNever()}</option>
                    </Select>
                </div>
                <div>
                    <label class="text-xs text-muted-foreground mb-1 block" for="dm-policy">{m.provision_dmPolicy()}</label>
                    <Select id="dm-policy" bind:value={provisionState.config.dmPolicy} size="md">
                        <option value="pairing">{m.provision_dmPairing()}</option>
                        <option value="solo">{m.provision_dmSolo()}</option>
                        <option value="disabled">{m.provision_dmDisabled()}</option>
                    </Select>
                </div>
            </div>
        </div>
    </div>

    <!-- Install -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Package size={12} class="text-muted-strong" />
            {m.provision_install()}
        </h3>
        <div class="grid grid-cols-2 gap-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="install-method">{m.provision_installMethod()}</label>
                <Select id="install-method" bind:value={provisionState.config.installMethod} size="md">
                    <option value="package">{m.provision_installPackage()}</option>
                    <option value="source">{m.provision_installSource()}</option>
                </Select>
            </div>
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="pkg-manager">{m.provision_pkgManager()}</label>
                <Select id="pkg-manager" bind:value={provisionState.config.pkgManager} size="md">
                    <option value="npm">npm</option>
                    <option value="bun">bun</option>
                </Select>
            </div>
        </div>
    </div>

    <!-- Gateway -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Radio size={12} class="text-muted-strong" />
            {m.provision_gateway()}
        </h3>
        <div class="grid grid-cols-2 gap-2.5">
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="gw-port">{m.provision_port()}</label>
                <input
                    id="gw-port"
                    type="number"
                    bind:value={provisionState.config.gatewayPort}
                    placeholder="18789"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div>
                <label class="text-xs text-muted-foreground mb-1 block" for="gw-bind">{m.provision_bind()}</label>
                <Select id="gw-bind" bind:value={provisionState.config.gatewayBind} size="md">
                    <option value="loopback">{m.provision_bindLoopback()}</option>
                    <option value="all">{m.provision_bindAll()}</option>
                </Select>
            </div>
        </div>
    </div>

    <!-- Channels -->
    <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">
            {m.provision_channels()}
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
            <Key size={12} class="text-muted-strong" />
            {m.provision_credentials()}
        </h3>
        <div>
            <label class="text-xs text-muted-foreground mb-1 block" for="api-key">{m.provision_apiKey()}</label>
            <input
                id="api-key"
                type="password"
                bind:value={provisionState.config.apiKey}
                placeholder="sk-ant-..."
                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p class="text-[10px] text-muted-strong mt-1">
                {m.provision_apiKeyHint()}
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
            {m.provision_saving()}
        {:else}
            <Save size={14} />
            {m.provision_saveConfiguration()}
        {/if}
    </button>
</div>
