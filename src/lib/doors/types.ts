import type { Attribution } from './attribution';

/**
 * Door kinds (spec 041). Each kind is a set of files discovered by convention
 * (contracts/kinds-and-api.md): a kind with no module is not creatable and its
 * doors 404 publicly. Booking links (`sched_links`) appear in the Doors view as
 * kind `book` but are not doors.
 */
export const DOOR_KINDS = ['form', 'faq', 'offer'] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];

/** A `crm_doors` row as the hub hands it to pages, APIs and kind modules. */
export interface DoorRow {
  id: string;
  orgId: string;
  kind: DoorKind;
  slug: string;
  title: string;
  description: string | null;
  active: boolean;
  config: unknown;
  followUp: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Public-safe projection a kind's `publicView` returns (no PII, no drafts). */
export type PublicDoorData = Record<string, unknown>;

/** Props of `src/lib/components/doors/<kind>/Public.svelte`. */
export interface DoorPublicProps {
  door: { slug: string; title: string; description: string | null };
  data: PublicDoorData;
  attribution: Attribution;
}

/** Props of `src/lib/components/doors/<kind>/Editor.svelte` (controlled; the page owns save). */
export interface DoorEditorProps {
  config: unknown;
  onchange: (config: unknown) => void;
  canManage: boolean;
}

/** Props of `src/lib/components/doors/panels/*.svelte` (a panel fetches its own data). */
export interface DoorPanelProps {
  door: DoorRow;
  canManage: boolean;
}

/** One row of the Doors view: a door or a booking link, with its funnel for the range. */
export interface DoorListRow {
  /** Stats key: `door:<id>` | `book:<id>`. */
  key: string;
  id: string;
  kind: DoorKind | 'book';
  slug: string;
  title: string;
  active: boolean;
  views: number;
  /** Form submissions, or bookings for a booking link. */
  submissions: number;
  /** Offer doors: WhatsApp + Reservar button clicks (beacon, approximate). */
  clicks: number;
  /** Contacts this door created in the range (`first_touch.door`). */
  contacts: number;
  /** Of those, with ≥1 submitted POS ticket or completed booking. */
  customers: number;
  /** Booking links only: the fields `PATCH /api/scheduling/links/[id]` replaces. */
  link?: {
    description: string | null;
    eventTypeIds: string[];
    resourceId: string | null;
    expiresAt: string | null;
  };
}
