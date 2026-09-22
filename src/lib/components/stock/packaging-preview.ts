/**
 * Pure tier math for the item packaging builder + Packaging card.
 * One equation drives everything: 1 package = pieces × perPiece = total usage.
 * Kept dependency-free (like stock-ui.ts) so the item page's previews are
 * unit-testable without mounting a component.
 */
import { gaugeMax, type UomConvertible } from './stock-ui';
import { MAX_MARKERS } from './stock-svg';

/**
 * How this item is broken down between the ORDER tier and the USAGE tier.
 *   pieces → 1 caja = 10 vials × 50 ml   (both tiers)
 *   bulk   → 1 caja = 500 ml             (no pieces)
 *   count  → no conversion at all        (e.g. a 'sesión')
 * Derived from the row; never stored.
 */
export type PackagingMode = 'pieces' | 'bulk' | 'count';

export function packagingMode(i: UomConvertible): PackagingMode {
  if (!i.consumptionUom || !(Number(i.unitsPerStockUom) > 0)) return 'count';
  return Number(i.subunitsPerStockUom) > 0 ? 'pieces' : 'bulk';
}

export interface PackagingFacts {
  mode: PackagingMode;
  /** Usage units per piece (pieces mode) or per package (bulk); 0 = none. */
  gaugeMax: number;
  /** Pieces inside one package (pieces mode), else 0. */
  pieces: number;
  /** Usage units inside one package, else 0. */
  perPackage: number;
  /** Whether the marker grid can draw this many pieces. */
  drawable: boolean;
  /** On-hand split for the diagram: whole packages + the open one's pieces. */
  wholePackages: number;
  openPieces: number;
  /** Markers to fill in the diagram: the open package, or a sealed full one. */
  diagramFill: number;
  /** On hand translated to every tier the item defines. */
  onHandPieces: number;
  onHandUsage: number;
}

export function packagingFacts(u: UomConvertible, onHand: number): PackagingFacts {
  const mode = packagingMode(u);
  const pieces = mode === 'pieces' ? Math.floor(Number(u.subunitsPerStockUom)) : 0;
  const perPackage = mode === 'count' ? 0 : Number(u.unitsPerStockUom) || 0;
  const wholePackages = Math.floor(onHand + 1e-9);
  const openPieces = pieces > 0 ? (onHand - wholePackages) * pieces : 0;
  return {
    mode,
    gaugeMax: mode === 'count' ? 0 : gaugeMax(u),
    pieces,
    perPackage,
    drawable: pieces >= 1 && pieces <= MAX_MARKERS,
    wholePackages,
    openPieces,
    diagramFill: openPieces > 0 ? openPieces : wholePackages > 0 ? pieces : 0,
    onHandPieces: pieces > 0 ? onHand * pieces : 0,
    onHandUsage: perPackage > 0 ? onHand * perPackage : 0,
  };
}

/** Round to 4 dp — enough for any clinic dose, stable through ÷ and ×. */
export const round4 = (n: number): number => Math.round(n * 10000) / 10000;
