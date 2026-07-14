export const AUDIT_VIEWPORTS = {
  'compact-360': { width: 360, height: 800, class: 'compact' },
  'compact-390': { width: 390, height: 844, class: 'compact' },
  'medium-portrait': { width: 768, height: 1024, class: 'medium' },
  'medium-landscape': { width: 1024, height: 768, class: 'medium' },
  'wide-1280': { width: 1280, height: 800, class: 'wide' },
  'wide-1440': { width: 1440, height: 900, class: 'wide' },
} as const;

export type AuditViewportId = keyof typeof AUDIT_VIEWPORTS;

const LEGACY_VIEWPORT_ALIASES: Readonly<Record<string, AuditViewportId>> = {
  compact: 'compact-390',
  medium: 'medium-portrait',
  wide: 'wide-1440',
};

export function resolveAuditViewport(value: string | undefined) {
  const id = LEGACY_VIEWPORT_ALIASES[value ?? ''] ?? value ?? 'wide-1440';
  if (!(id in AUDIT_VIEWPORTS)) {
    throw new Error(
      `Unknown E2E_UI_AUDIT_VIEWPORT=${value}. Expected ${Object.keys(AUDIT_VIEWPORTS).join(', ')}.`,
    );
  }
  return { id: id as AuditViewportId, ...AUDIT_VIEWPORTS[id as AuditViewportId] };
}
