import type { Component } from 'svelte';
import type { DoorEditorProps, DoorKind, DoorPanelProps, DoorPublicProps } from '$lib/doors/types';

/**
 * Component registry for door kinds (spec 041, contracts/kinds-and-api.md).
 * A kind slice adds `./<kind>/Public.svelte` and `./<kind>/Editor.svelte`; a
 * panel adds `./panels/<Name>.svelte` with `export const kinds: DoorKind[]` in
 * its `<script module>`. Public components are eager (the public page needs
 * one synchronously); editors and panels load lazily so the anonymous `/d/`
 * bundle never carries hub-side editing code.
 */
type PublicModule = { default: Component<DoorPublicProps> };
type EditorModule = { default: Component<DoorEditorProps> };
type PanelModule = { default: Component<DoorPanelProps>; kinds: DoorKind[] };

const publics = import.meta.glob<PublicModule>('./*/Public.svelte', { eager: true });
const editors = import.meta.glob<EditorModule>('./*/Editor.svelte');
const panels = import.meta.glob<PanelModule>('./panels/*.svelte');

export function getDoorPublic(kind: string): Component<DoorPublicProps> | undefined {
  return publics[`./${kind}/Public.svelte`]?.default;
}

export async function loadDoorEditor(
  kind: string,
): Promise<Component<DoorEditorProps> | undefined> {
  return (await editors[`./${kind}/Editor.svelte`]?.())?.default;
}

/** Panels whose `kinds` include `kind`, in file-name order. */
export async function loadDoorPanels(kind: string): Promise<Component<DoorPanelProps>[]> {
  const mods = await Promise.all(
    Object.keys(panels)
      .sort()
      .map((path) => panels[path]()),
  );
  return mods.filter((mod) => mod.kinds?.includes(kind as DoorKind)).map((mod) => mod.default);
}
