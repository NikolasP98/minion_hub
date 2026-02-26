<script lang="ts">
    import { logoState } from "$lib/state/logo.svelte";

    interface Props {
        /** Show text next to the mark */
        showText?: boolean;
        /** Size variant */
        size?: "sm" | "md" | "lg";
        /** Use compact style (no background shape) */
        compact?: boolean;
        /** Additional classes */
        class?: string;
        /** Override preset (optional) */
        preset?: string;
    }

    let {
        showText = false,
        size = "md",
        compact = false,
        class: className = "",
        preset: presetOverride,
    }: Props = $props();

    const currentPreset = $derived(
        presetOverride
            ? (logoState.presets.find((p) => p.id === presetOverride) ??
                  logoState.preset)
            : logoState.preset,
    );

    const dimensions = $derived.by(() => {
        switch (size) {
            case "sm":
                return { mark: 24, text: "text-sm" };
            case "lg":
                return { mark: 48, text: "text-xl" };
            default:
                return { mark: 32, text: "text-base" };
        }
    });

    const brandPink = "#e8547a";
</script>

<div
    class="flex items-center gap-2 select-none {className}"
    class:gap-3={size === "lg"}
>
    <!-- Dynamic Logo Mark based on preset -->
    {#if currentPreset.id === "squid"}
        <!-- Squid-inspired design with textured skin and large eyes -->
        <svg
            width={dimensions.mark}
            height={dimensions.mark}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0"
            aria-hidden="true"
        >
            {#if !compact}
                <!-- Textured skin background -->
                <rect
                    width="32"
                    height="32"
                    rx="7"
                    fill={currentPreset.bgColor}
                />
                <!-- Skin texture dots -->
                <circle cx="5" cy="7" r="0.6" fill="#803030" opacity="0.3" />
                <circle cx="9" cy="4" r="0.5" fill="#803030" opacity="0.25" />
                <circle cx="23" cy="6" r="0.55" fill="#803030" opacity="0.3" />
                <circle cx="19" cy="9" r="0.45" fill="#803030" opacity="0.25" />
                <circle cx="7" cy="21" r="0.5" fill="#803030" opacity="0.25" />
                <circle cx="25" cy="19" r="0.6" fill="#803030" opacity="0.3" />
                <circle cx="15" cy="26" r="0.4" fill="#803030" opacity="0.2" />
                <circle cx="27" cy="12" r="0.5" fill="#803030" opacity="0.25" />
            {/if}

            <!-- Left eye -->
            <ellipse
                cx="10"
                cy="14"
                rx="5"
                ry="6"
                fill={compact ? "none" : "#f0f0f0"}
                stroke={compact ? currentPreset.bgColor : "#1a1a2e"}
                stroke-width={compact ? 1.5 : 1.5}
            />
            <ellipse
                cx="10"
                cy="14"
                rx="2.5"
                ry="3.5"
                fill={compact ? currentPreset.bgColor : "#1a1a2e"}
            />
            <circle cx="11" cy="12.5" r="1" fill="white" opacity="0.7" />

            <!-- Right eye -->
            <ellipse
                cx="22"
                cy="14"
                rx="5"
                ry="6"
                fill={compact ? "none" : "#f0f0f0"}
                stroke={compact ? currentPreset.bgColor : "#1a1a2e"}
                stroke-width={compact ? 1.5 : 1.5}
            />
            <ellipse
                cx="22"
                cy="14"
                rx="2.5"
                ry="3.5"
                fill={compact ? currentPreset.bgColor : "#1a1a2e"}
            />
            <circle cx="23" cy="12.5" r="1" fill="white" opacity="0.7" />

            <!-- Subtle mouth -->
            <path
                d="M14 24 Q16 26 18 24"
                stroke={compact ? currentPreset.bgColor : "#8b4040"}
                stroke-width="1"
                fill="none"
                stroke-linecap="round"
            />
        </svg>
    {:else if currentPreset.id === "agent"}
        <!-- Abstract agent node -->
        <svg
            width={dimensions.mark}
            height={dimensions.mark}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0"
            aria-hidden="true"
        >
            {#if !compact}
                <rect
                    width="32"
                    height="32"
                    rx="7"
                    fill={currentPreset.bgColor}
                />
            {/if}
            <!-- Central node -->
            <circle
                cx="16"
                cy="16"
                r="5"
                fill={compact ? currentPreset.secondaryColor : "#3b82f6"}
            />
            <!-- Orbiting nodes -->
            <circle
                cx="16"
                cy="6"
                r="2.5"
                fill={compact ? currentPreset.secondaryColor : "#60a5fa"}
            />
            <circle
                cx="25"
                cy="22"
                r="2.5"
                fill={compact ? currentPreset.secondaryColor : "#60a5fa"}
            />
            <circle
                cx="7"
                cy="22"
                r="2.5"
                fill={compact ? currentPreset.secondaryColor : "#60a5fa"}
            />
            <!-- Connection lines -->
            <path
                d="M16 11 L16 8.5 M20.5 19 L23 20.5 M11.5 19 L9 20.5"
                stroke={compact ? currentPreset.secondaryColor : "#3b82f6"}
                stroke-width="1.5"
                stroke-linecap="round"
            />
        </svg>
    {:else if currentPreset.id === "orbital"}
        <!-- Planetary rings -->
        <svg
            width={dimensions.mark}
            height={dimensions.mark}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0"
            aria-hidden="true"
        >
            {#if !compact}
                <rect
                    width="32"
                    height="32"
                    rx="7"
                    fill={currentPreset.bgColor}
                />
            {/if}
            <!-- Planet -->
            <circle
                cx="16"
                cy="16"
                r="6"
                fill={compact ? currentPreset.secondaryColor : "#a855f7"}
            />
            <circle cx="14" cy="14" r="2" fill="#c084fc" opacity="0.5" />
            <!-- Ring -->
            <ellipse
                cx="16"
                cy="16"
                rx="12"
                ry="4"
                fill="none"
                stroke={compact ? currentPreset.secondaryColor : "#a855f7"}
                stroke-width="1.5"
                transform="rotate(-20 16 16)"
            />
            <!-- Moons -->
            <circle cx="24" cy="10" r="1.5" fill="#d8b4fe" />
            <circle cx="8" cy="22" r="1.5" fill="#d8b4fe" />
        </svg>
    {:else if currentPreset.id === "hex"}
        <!-- Geometric hexagon -->
        <svg
            width={dimensions.mark}
            height={dimensions.mark}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0"
            aria-hidden="true"
        >
            {#if !compact}
                <rect
                    width="32"
                    height="32"
                    rx="7"
                    fill={currentPreset.bgColor}
                />
            {/if}
            <!-- Outer hexagon -->
            <polygon
                points="16,4 26,9 26,23 16,28 6,23 6,9"
                fill="none"
                stroke={compact ? currentPreset.secondaryColor : "#22c55e"}
                stroke-width="2"
            />
            <!-- Inner hexagon -->
            <polygon
                points="16,10 21,13 21,19 16,22 11,19 11,13"
                fill={compact ? currentPreset.secondaryColor : "#22c55e"}
                opacity="0.3"
            />
            <!-- Center dot -->
            <circle
                cx="16"
                cy="16"
                r="2"
                fill={compact ? currentPreset.secondaryColor : "#22c55e"}
            />
        </svg>
    {:else}
        <!-- Default Minion - stylized goggles -->
        <svg
            width={dimensions.mark}
            height={dimensions.mark}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0"
            aria-hidden="true"
        >
            {#if !compact}
                <!-- Background shape: rounded square with subtle gradient -->
                <rect width="32" height="32" rx="7" fill={brandPink} />
                <!-- Inner highlight for depth -->
                <rect
                    x="1"
                    y="1"
                    width="30"
                    height="30"
                    rx="6"
                    fill="url(#minion-gradient)"
                    fill-opacity="0.15"
                />
            {/if}

            <!-- The "M" mark - stylized as minion goggles/face -->
            <g transform="translate(4, 4)">
                <!-- Left eye (goggle) -->
                <circle
                    cx="6"
                    cy="8"
                    r="4"
                    fill="none"
                    stroke={compact ? brandPink : "#0a0a0a"}
                    stroke-width="2.5"
                />
                <circle
                    cx="6"
                    cy="8"
                    r="1.5"
                    fill={compact ? brandPink : "#0a0a0a"}
                />

                <!-- Right eye (goggle) -->
                <circle
                    cx="18"
                    cy="8"
                    r="4"
                    fill="none"
                    stroke={compact ? brandPink : "#0a0a0a"}
                    stroke-width="2.5"
                />
                <circle
                    cx="18"
                    cy="8"
                    r="1.5"
                    fill={compact ? brandPink : "#0a0a0a"}
                />

                <!-- Connecting strap -->
                <path
                    d="M10 8h4"
                    stroke={compact ? brandPink : "#0a0a0a"}
                    stroke-width="2.5"
                    stroke-linecap="round"
                />

                <!-- Minion smile -->
                <path
                    d="M6 15c2.5 2 7.5 2 10 0"
                    stroke={compact ? brandPink : "#0a0a0a"}
                    stroke-width="2"
                    stroke-linecap="round"
                    fill="none"
                />
            </g>

            {#if !compact}
                <defs>
                    <linearGradient
                        id="minion-gradient"
                        x1="0"
                        y1="0"
                        x2="32"
                        y2="32"
                    >
                        <stop offset="0%" stop-color="white" />
                        <stop
                            offset="100%"
                            stop-color="white"
                            stop-opacity="0"
                        />
                    </linearGradient>
                </defs>
            {/if}
        </svg>
    {/if}

    {#if showText}
        <div class="flex items-center leading-none {dimensions.text}">
            <span
                class="font-black tracking-wide uppercase"
                style="color: {currentPreset.id === 'minion'
                    ? brandPink
                    : currentPreset.secondaryColor}">MINION</span
            >
            <span class="font-bold text-foreground/90 ml-1">hub</span>
        </div>
    {/if}
</div>
