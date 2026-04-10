// ─── Image Studio — brand-locked image generation state ───

import { toastError } from '$lib/state/ui/toast.svelte';
import * as m from '$lib/paraglide/messages';

// ─── Image Models ───

export interface ImageModel {
  id: string;
  label: string;
  provider: string;
  costPerImage: number; // USD estimate per generation (0 = free/preview)
}

export const IMAGE_MODELS: ImageModel[] = [
  { id: 'openai/gpt-5-image-mini', label: 'GPT-5 Image Mini', provider: 'OpenAI', costPerImage: 0.02 },
  { id: 'openai/gpt-5-image', label: 'GPT-5 Image', provider: 'OpenAI', costPerImage: 0.05 },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash', provider: 'Google', costPerImage: 0.01 },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', provider: 'Google', costPerImage: 0.01 },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', provider: 'Google', costPerImage: 0.03 },
  { id: 'imagen-4.0-fast-generate-001', label: 'Imagen 4 Fast', provider: 'Google', costPerImage: 0.02 },
  { id: 'imagen-4.0-generate-001', label: 'Imagen 4', provider: 'Google', costPerImage: 0.04 },
  { id: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4 Ultra', provider: 'Google', costPerImage: 0.08 },
];

// ─── Types ───

export type ContentType = 'agent-avatar' | 'app-icon' | 'banner-hero' | 'background-pattern' | 'ui-illustration' | 'social-media';
export type VisualStyle = 'flat' | '3d-render' | 'pixel-art' | 'isometric' | 'line-art' | 'photorealistic' | 'glassmorphism';
export type Texture = 'smooth' | 'grainy-film' | 'glossy' | 'matte' | 'noise' | 'gradient-mesh';
export type ColorMood = 'brand' | 'cool' | 'warm' | 'monochrome' | 'neon-cyberpunk' | 'earth-tones';
export type Lighting = 'soft-ambient' | 'dramatic-side' | 'neon-glow' | 'backlit-rim' | 'natural-daylight';
export type CameraAngle = 'close-up' | 'wide-shot' | 'birds-eye' | 'isometric' | 'straight-on';
export type ImageFormat = '1:1' | '3:4' | '16:9' | '3:1' | '1:1-small';
export type Resolution = '1K' | '2K' | '4K';

export interface GeneratedImage {
  id: string;
  base64: string;
  mimeType: string;
  selections: StudioSelections;
  timestamp: number;
}

export interface StudioSelections {
  contentType: ContentType;
  visualStyle: VisualStyle;
  texture: Texture;
  colorMood: ColorMood;
  lighting: Lighting;
  cameraAngle: CameraAngle;
  imageFormat: ImageFormat;
  resolution: Resolution;
  refineText: string;
}

// ─── Prompt Fragment Maps ───

const SYSTEM_PREFIX =
  'Create a professional image for a dark-themed AI platform dashboard called Minion. Brand guidelines: dark backgrounds (#09090b to #27272a), clean sans-serif typography similar to Inter, primary accent color #e8547a (vibrant pink), secondary blue #3b82f6. Modern, minimal, tech-forward aesthetic with subtle depth.';

const CONTENT_TYPE_FRAGMENTS: Record<ContentType, string> = {
  'agent-avatar': 'Generate a circular agent avatar portrait with clean edges suitable for a profile picture, featuring an abstract or stylized character',
  'app-icon': 'Generate a square app icon with a bold, recognizable silhouette and minimal detail, suitable for small display sizes',
  'banner-hero': 'Generate a wide hero banner image with dynamic composition, depth, and visual flow from left to right',
  'background-pattern': 'Generate a seamless tileable background pattern with subtle geometric or organic elements',
  'ui-illustration': 'Generate a UI illustration or decorative element for a dashboard interface, suitable as an empty-state graphic or feature visual',
  'social-media': 'Generate a social media asset suitable for Open Graph cards or promotional posts, with strong visual hierarchy',
};

const VISUAL_STYLE_FRAGMENTS: Record<VisualStyle, string> = {
  'flat': 'in flat design style with solid shapes, clean edges, and minimal gradients',
  '3d-render': 'in soft 3D render style with subtle lighting, rounded forms, and gentle shadows',
  'pixel-art': 'in pixel art style with crisp blocky shapes, limited color palette, and retro charm',
  'isometric': 'in isometric projection style with precise geometry and consistent 30-degree angles',
  'line-art': 'in line art style with clean strokes, minimal fills, and elegant simplicity',
  'photorealistic': 'in photorealistic style with natural textures, accurate lighting, and fine detail',
  'glassmorphism': 'in glassmorphism style with frosted glass panels, blur effects, subtle transparency, and luminous edges',
};

const TEXTURE_FRAGMENTS: Record<Texture, string> = {
  'smooth': 'with smooth, clean surfaces and sharp precise edges',
  'grainy-film': 'with film grain texture and subtle noise for analog warmth',
  'glossy': 'with glossy reflective surfaces and specular highlights',
  'matte': 'with matte surfaces and soft diffuse finish',
  'noise': 'with digital noise texture and slight dithering effect',
  'gradient-mesh': 'with flowing gradient mesh textures and color transitions',
};

const COLOR_MOOD_FRAGMENTS: Record<ColorMood, string> = {
  'brand': 'using the brand color palette: vibrant pink (#e8547a) as primary accent with dark charcoal (#09090b) backgrounds and off-white (#fafafa) highlights',
  'cool': 'using a cool color palette: blues (#3b82f6), cyans (#06b6d4), and purples (#a855f7) against dark backgrounds',
  'warm': 'using a warm color palette: ambers (#f59e0b), pinks (#e8547a), and soft oranges against dark backgrounds',
  'monochrome': 'using a monochrome palette: shades of gray from near-black (#09090b) to off-white (#fafafa) with no color accents',
  'neon-cyberpunk': 'using a neon cyberpunk palette: electric blues, hot pinks (#e8547a), acid greens (#22c55e), and deep purple (#a855f7) glowing against jet black',
  'earth-tones': 'using earth tones: warm browns, muted greens (#10b981), soft terracotta, and stone grays against dark backgrounds',
};

const LIGHTING_FRAGMENTS: Record<Lighting, string> = {
  'soft-ambient': 'with soft ambient lighting, even illumination, and no harsh shadows',
  'dramatic-side': 'with dramatic side lighting creating strong contrast between light and shadow',
  'neon-glow': 'with neon glow lighting, color-emitting edges, and bloom effects',
  'backlit-rim': 'with backlighting creating a rim light effect and silhouette contrast',
  'natural-daylight': 'with natural daylight illumination, soft warm tones, and gentle shadows',
};

const CAMERA_FRAGMENTS: Record<CameraAngle, string> = {
  'close-up': 'from a close-up perspective, filling the frame with the subject',
  'wide-shot': 'from a wide shot perspective showing the full scene with context',
  'birds-eye': 'from a bird\'s eye top-down perspective looking straight down',
  'isometric': 'from an isometric 3/4 elevated perspective',
  'straight-on': 'from a straight-on frontal perspective at eye level',
};

const FORMAT_FRAGMENTS: Record<ImageFormat, string> = {
  '1:1': 'Output as a square 1:1 image',
  '3:4': 'Output as a portrait 3:4 vertical image',
  '16:9': 'Output as a landscape 16:9 widescreen image',
  '3:1': 'Output as a wide 3:1 panoramic banner image',
  '1:1-small': 'Output as a small square 1:1 icon image with extra clarity at small size',
};

// ─── Category definitions for the UI ───

export interface CategoryOption {
  id: string;
  label: string;
  icon: string;
}

export interface Category {
  key: keyof StudioSelections;
  label: string;
  options: CategoryOption[];
}

export const CATEGORIES: Category[] = [
  {
    key: 'contentType',
    label: 'Content',
    options: [
      { id: 'agent-avatar', label: 'Avatar', icon: '👤' },
      { id: 'app-icon', label: 'Icon', icon: '⬜' },
      { id: 'banner-hero', label: 'Banner', icon: '🖼' },
      { id: 'background-pattern', label: 'Pattern', icon: '◈' },
      { id: 'ui-illustration', label: 'Illustration', icon: '✦' },
      { id: 'social-media', label: 'Social', icon: '◻' },
    ],
  },
  {
    key: 'visualStyle',
    label: 'Style',
    options: [
      { id: 'flat', label: 'Flat', icon: '▬' },
      { id: '3d-render', label: '3D', icon: '◆' },
      { id: 'pixel-art', label: 'Pixel', icon: '▦' },
      { id: 'isometric', label: 'Iso', icon: '◇' },
      { id: 'line-art', label: 'Line', icon: '╱' },
      { id: 'photorealistic', label: 'Photo', icon: '◎' },
      { id: 'glassmorphism', label: 'Glass', icon: '◻' },
    ],
  },
  {
    key: 'texture',
    label: 'Texture',
    options: [
      { id: 'smooth', label: 'Smooth', icon: '○' },
      { id: 'grainy-film', label: 'Grain', icon: '░' },
      { id: 'glossy', label: 'Glossy', icon: '◉' },
      { id: 'matte', label: 'Matte', icon: '●' },
      { id: 'noise', label: 'Noise', icon: '▒' },
      { id: 'gradient-mesh', label: 'Mesh', icon: '◐' },
    ],
  },
  {
    key: 'colorMood',
    label: 'Color',
    options: [
      { id: 'brand', label: 'Brand', icon: '♦' },
      { id: 'cool', label: 'Cool', icon: '❄' },
      { id: 'warm', label: 'Warm', icon: '☀' },
      { id: 'monochrome', label: 'Mono', icon: '◑' },
      { id: 'neon-cyberpunk', label: 'Neon', icon: '⚡' },
      { id: 'earth-tones', label: 'Earth', icon: '☘' },
    ],
  },
  {
    key: 'lighting',
    label: 'Lighting',
    options: [
      { id: 'soft-ambient', label: 'Ambient', icon: '◯' },
      { id: 'dramatic-side', label: 'Dramatic', icon: '◑' },
      { id: 'neon-glow', label: 'Glow', icon: '✧' },
      { id: 'backlit-rim', label: 'Backlit', icon: '◍' },
      { id: 'natural-daylight', label: 'Daylight', icon: '☀' },
    ],
  },
  {
    key: 'cameraAngle',
    label: 'Camera',
    options: [
      { id: 'close-up', label: 'Close', icon: '⊕' },
      { id: 'wide-shot', label: 'Wide', icon: '⊞' },
      { id: 'birds-eye', label: 'Top', icon: '⊙' },
      { id: 'isometric', label: 'Iso', icon: '◇' },
      { id: 'straight-on', label: 'Front', icon: '⊡' },
    ],
  },
  {
    key: 'imageFormat',
    label: 'Format',
    options: [
      { id: '1:1', label: '1:1', icon: '■' },
      { id: '3:4', label: '3:4', icon: '▮' },
      { id: '16:9', label: '16:9', icon: '▬' },
      { id: '3:1', label: '3:1', icon: '━' },
      { id: '1:1-small', label: 'Icon', icon: '▪' },
    ],
  },
  {
    key: 'resolution',
    label: 'Resolution',
    options: [
      { id: '1K', label: '1K', icon: '' },
      { id: '2K', label: '2K', icon: '' },
      { id: '4K', label: '4K', icon: '' },
    ],
  },
];

// ─── State ───

export const studioState = $state({
  contentType: 'agent-avatar' as ContentType,
  visualStyle: 'flat' as VisualStyle,
  texture: 'smooth' as Texture,
  colorMood: 'brand' as ColorMood,
  lighting: 'soft-ambient' as Lighting,
  cameraAngle: 'straight-on' as CameraAngle,
  imageFormat: '1:1' as ImageFormat,
  resolution: '1K' as Resolution,
  model: IMAGE_MODELS[0].id,
  refineText: '',
  generating: false,
  currentImage: null as GeneratedImage | null,
  history: [] as GeneratedImage[],
  error: null as string | null,
});

// ─── Prompt composition ───

export function composePrompt(): string {
  const parts = [
    SYSTEM_PREFIX,
    CONTENT_TYPE_FRAGMENTS[studioState.contentType],
    VISUAL_STYLE_FRAGMENTS[studioState.visualStyle],
    TEXTURE_FRAGMENTS[studioState.texture],
    COLOR_MOOD_FRAGMENTS[studioState.colorMood],
    LIGHTING_FRAGMENTS[studioState.lighting],
    CAMERA_FRAGMENTS[studioState.cameraAngle],
    FORMAT_FRAGMENTS[studioState.imageFormat],
  ];

  if (studioState.refineText.trim()) {
    parts.push(`Additional details: ${studioState.refineText.trim()}`);
  }

  return parts.join('. ') + '.';
}

// ─── Generation ───

const HISTORY_KEY = 'studio-history';
const MAX_HISTORY = 10;

export async function generate() {
  studioState.generating = true;
  studioState.error = null;

  const prompt = composePrompt();
  const selections: StudioSelections = {
    contentType: studioState.contentType,
    visualStyle: studioState.visualStyle,
    texture: studioState.texture,
    colorMood: studioState.colorMood,
    lighting: studioState.lighting,
    cameraAngle: studioState.cameraAngle,
    imageFormat: studioState.imageFormat,
    resolution: studioState.resolution,
    refineText: studioState.refineText,
  };

  try {
    const res = await fetch('/api/studio/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, resolution: studioState.resolution, model: studioState.model }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: 'Generation failed' }));
      throw new Error(body.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const img: GeneratedImage = {
      id: crypto.randomUUID(),
      base64: data.image.base64,
      mimeType: data.image.mimeType,
      selections,
      timestamp: Date.now(),
    };

    studioState.currentImage = img;
    studioState.history = [img, ...studioState.history].slice(0, MAX_HISTORY);
    saveHistory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : m.studio_unknownError();
    studioState.error = msg;
    toastError(m.studio_generationFailed(), msg);
  } finally {
    studioState.generating = false;
  }
}

// ─── History persistence ───

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      studioState.history = JSON.parse(raw) as GeneratedImage[];
    }
  } catch { /* ignore corrupt data */ }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(studioState.history));
  } catch { /* quota exceeded — silently drop */ }
}

// ─── Restore selections from a history entry ───

export function restoreFromHistory(img: GeneratedImage) {
  studioState.currentImage = img;
  studioState.contentType = img.selections.contentType;
  studioState.visualStyle = img.selections.visualStyle;
  studioState.texture = img.selections.texture;
  studioState.colorMood = img.selections.colorMood;
  studioState.lighting = img.selections.lighting;
  studioState.cameraAngle = img.selections.cameraAngle;
  studioState.imageFormat = img.selections.imageFormat;
  studioState.resolution = img.selections.resolution;
  studioState.refineText = img.selections.refineText;
}

// ─── Aspect ratio helper ───

export function getAspectRatio(format: ImageFormat): string {
  switch (format) {
    case '1:1': return '1 / 1';
    case '3:4': return '3 / 4';
    case '16:9': return '16 / 9';
    case '3:1': return '3 / 1';
    case '1:1-small': return '1 / 1';
  }
}
