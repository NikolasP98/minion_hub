import type { ContactGraphRow } from '$server/services/crm-contacts.service';
import type { GraphNode, GraphEdge } from '$lib/components/overview/graph/build-graph';
import { chartColors, type ChartColors } from '$lib/utils/chart-colors';
import type { RelationshipCategory } from '$lib/components/crm/crm-relationship';

export interface BuildCrmGraphInput {
  org: { id: string; name: string };
  rows: ContactGraphRow[];
}

/** Ring radii for the CRM graph's own (much shallower) structure — org center,
 *  then contacts on a single ring (spec v2 R5 defers a category ring layout).
 *  Passed to the shared renderer as its `RendererPresentation.rings`, which
 *  otherwise defaults to the overview org/area/skill/integration/agent/user
 *  radii. */
export const CRM_RADII = { org: 0, contact: 480 } as const;

const FG = '#fafafa';
const DIM = '#a1a1aa';
/** Neutral dot for every contact node — category lives on the edge color
 *  (spec v2 R5); keeps the node itself legible against any category hue. */
const CONTACT_COLOR = '#71717a';

/** Category → semantic-token-derived color (spec v2 §C2), resolved from the
 *  same theme-aware palette ECharts panels use (`chartColors()` — falls back
 *  to the canonical hex when there's no live theme, e.g. SSR/tests). Neutral
 *  for `unknown`/no relationship yet. */
export function relationshipCategoryColor(
  category: RelationshipCategory | null | undefined,
  colors: ChartColors = chartColors(),
): string {
  switch (category) {
    case 'family':
      return colors.emerald;
    case 'romantic_partner':
      return colors.pink;
    case 'friend':
      return colors.accent;
    case 'work':
      return colors.purple;
    case 'acquaintance':
      return colors.cyan;
    case 'service':
      return colors.warning;
    case 'other':
      return colors.mutedForeground;
    case 'unknown':
    default:
      return colors.muted;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Edge opacity = recency decay — floors at 0.12 (still visible) and never
 *  exceeds 0.85 (edges stay secondary to nodes). ~30-day half-life-ish falloff. */
function recencyOpacity(iso: string | null, now: number): number {
  if (!iso) return 0.12;
  const days = Math.max(0, (now - new Date(iso).getTime()) / DAY_MS);
  return Math.max(0.12, Math.min(0.85, Math.exp(-days / 30)));
}

const at = (r: number, angle: number) => ({ ax: r * Math.cos(angle), ay: r * Math.sin(angle) });

/**
 * CRM relationship graph (spec v2 WP1): center "Me"/org + up to 60 ranked
 * contacts, one row per contact. Edges: center→contact, colored by the
 * contact's relationship category (neutral when unset/unknown), width scales
 * with the contact's total message count, opacity = recency decay.
 * Deliberately NO contact↔contact or party edges (party_id is an identity
 * bridge, not a relationship — near-clique noise otherwise) and NO channel
 * nodes (spec v2 removes them — channel is plumbing, not a relationship).
 */
export function buildCrmGraph(input: BuildCrmGraphInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { org, rows } = input;
  const now = Date.now();
  const colors = chartColors();

  const nodes: GraphNode[] = [
    {
      id: org.id,
      kind: 'org',
      label: org.name,
      color: FG,
      areaId: null,
      radius: CRM_RADII.org,
      ax: 0,
      ay: 0,
      symbolSize: 76,
      pinned: true,
      labelColor: FG,
      labelTier: 'primary',
      labelSize: 10,
      showLabel: true,
    },
  ];
  const edges: GraphEdge[] = [];

  const TAU = Math.PI * 2;
  const contactCount = rows.length;
  rows.forEach((row, i) => {
    const id = `contact:${row.contactId}`;
    const angle = contactCount <= 1 ? -Math.PI / 2 : (i / contactCount) * TAU;
    nodes.push({
      id,
      kind: 'contact',
      label: row.label,
      color: CONTACT_COLOR,
      areaId: null,
      radius: CRM_RADII.contact,
      ...at(CRM_RADII.contact, angle),
      symbolSize: 34,
      labelColor: DIM,
      labelTier: 'secondary',
      labelSize: 9.5,
      showLabel: true,
    });
    edges.push({
      source: org.id,
      target: id,
      color: relationshipCategoryColor(row.relationship?.category, colors),
      baseOpacity: recencyOpacity(row.lastAt, now),
      width: 1 + Math.min(5, Math.log(1 + row.messageCount)),
    });
  });

  return { nodes, edges };
}
