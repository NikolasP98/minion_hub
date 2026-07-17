<script lang="ts">
  import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, iconSizes } from '$lib/components/ui';
  import { formatTime } from './video-time';

  type Props = {
    src: string;
    poster?: string;
    class?: string;
  };

  let { src, poster, class: className = '' }: Props = $props();

  let wrapper: HTMLDivElement;
  let video: HTMLVideoElement;
  let currentTime = $state(0);
  let duration = $state(0);
  let paused = $state(true);
  let muted = $state(false);
  let ended = $state(false);
  let fullscreen = $state(false);

  const safeDuration = $derived(Number.isFinite(duration) ? duration : 0);
  const playbackLabel = $derived(paused ? m.video_play() : m.video_pause());

  function togglePlayback() {
    if (paused || ended) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  function seekTo(value: number) {
    currentTime = Math.min(Math.max(0, value), safeDuration);
  }

  function handleSeek(event: Event) {
    seekTo(Number((event.currentTarget as HTMLInputElement).value));
  }

  function toggleMute() {
    muted = !muted;
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement === wrapper) {
      await document.exitFullscreen?.();
    } else {
      await wrapper.requestFullscreen?.();
    }
  }

  function syncFullscreen() {
    fullscreen = document.fullscreenElement === wrapper;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.target !== wrapper) return;

    switch (event.key.toLowerCase()) {
      case ' ':
      case 'k':
        event.preventDefault();
        togglePlayback();
        break;
      case 'arrowleft':
        event.preventDefault();
        seekTo(currentTime - 5);
        break;
      case 'arrowright':
        event.preventDefault();
        seekTo(currentTime + 5);
        break;
      case 'm':
        event.preventDefault();
        toggleMute();
        break;
      case 'f':
        event.preventDefault();
        void toggleFullscreen();
        break;
    }
  }
</script>

<svelte:document onfullscreenchange={syncFullscreen} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- the focusable group owns player-wide keyboard shortcuts -->
<div
  bind:this={wrapper}
  class={`video-player ${paused ? 'is-paused' : ''} ${className}`}
  role="group"
  aria-label={m.video_player()}
  tabindex="0"
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_media_has_caption -- this reusable player receives CDN video media without a captions source -->
  <video
    bind:this={video}
    bind:currentTime
    bind:duration
    bind:paused
    bind:muted
    bind:ended
    {src}
    {poster}
    playsinline
    preload="metadata"
    aria-label={playbackLabel}
    onclick={togglePlayback}
  ></video>

  {#if paused}
    <div class="center-overlay">
      <Button
        class="center-control"
        variant="ghost"
        size="sm"
        shape="icon"
        aria-label={m.video_play()}
        onclick={togglePlayback}
      >
        <Play size={iconSizes.lg} fill="currentColor" aria-hidden="true" />
      </Button>
    </div>
  {/if}

  <div class="controls">
    <Button
      class="control-button"
      variant="ghost"
      size="sm"
      shape="icon"
      aria-label={playbackLabel}
      onclick={togglePlayback}
    >
      {#if paused}
        <Play size={iconSizes.md} fill="currentColor" aria-hidden="true" />
      {:else}
        <Pause size={iconSizes.md} fill="currentColor" aria-hidden="true" />
      {/if}
    </Button>

    <span class="time t-mono">{formatTime(currentTime)} / {formatTime(safeDuration)}</span>

    <input
      class="seek"
      type="range"
      min="0"
      max={safeDuration}
      step="0.1"
      value={currentTime}
      aria-label={m.video_seek()}
      oninput={handleSeek}
    />

    <Button
      class="control-button"
      variant="ghost"
      size="sm"
      shape="icon"
      aria-label={muted ? m.video_unmute() : m.video_mute()}
      onclick={toggleMute}
    >
      {#if muted}
        <VolumeX size={iconSizes.md} aria-hidden="true" />
      {:else}
        <Volume2 size={iconSizes.md} aria-hidden="true" />
      {/if}
    </Button>

    <Button
      class="control-button"
      variant="ghost"
      size="sm"
      shape="icon"
      aria-label={fullscreen ? m.video_exit_fullscreen() : m.video_fullscreen()}
      onclick={() => void toggleFullscreen()}
    >
      {#if fullscreen}
        <Minimize size={iconSizes.md} aria-hidden="true" />
      {:else}
        <Maximize size={iconSizes.md} aria-hidden="true" />
      {/if}
    </Button>
  </div>
</div>

<style>
  .video-player {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--color-overlay);
  }

  video {
    display: block;
    width: 100%;
    height: auto;
    cursor: pointer;
  }

  .center-overlay {
    position: absolute;
    inset: var(--space-0);
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .video-player :global(.center-control) {
    width: var(--space-12);
    height: var(--space-12);
    padding: var(--space-0);
    border-radius: var(--radius-full);
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-overlay) 75%, transparent);
    pointer-events: auto;
  }

  .video-player :global(.center-control > span) {
    width: 100%;
    height: 100%;
  }

  .controls {
    position: absolute;
    right: var(--space-0);
    bottom: var(--space-0);
    left: var(--space-0);
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-8) var(--space-2) var(--space-2);
    color: var(--color-text-primary);
    background: linear-gradient(to top, var(--color-overlay), transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }

  .video-player:hover .controls,
  .video-player:focus-within .controls,
  .video-player.is-paused .controls {
    opacity: 1;
    pointer-events: auto;
  }

  .video-player :global(.control-button) {
    color: var(--color-text-primary);
  }

  .time {
    white-space: nowrap;
  }

  .seek {
    width: 100%;
    min-width: var(--space-12);
    accent-color: var(--color-accent);
    cursor: pointer;
  }
</style>
