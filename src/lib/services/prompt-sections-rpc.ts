/**
 * Typed RPC wrappers for `prompt.sections.*` gateway methods.
 *
 * Thin convenience layer over `sendRequest` from `./gateway.svelte` — each function
 * issues a single WS request with the typed params/response pair from
 * `@minion-stack/shared`, and translates SECTION_VALIDATION_FAILED errors into
 * a structured `PromptSectionsError` so UI callers can switch on `.violations`
 * (Phase 20 D-10 inline-errors pattern).
 *
 * Consumed by `SectionBrowser.svelte`, `SectionEditor.svelte`, and
 * `PromptShell.svelte` for the `/(app)/prompt` route.
 */
import { sendRequest } from "./gateway.svelte";
import type {
  SectionMeta,
  SectionFull,
  SectionInput,
  PreviewResponse,
  PromptMode,
  OverridesGetResponse,
  OverridesSetResponse,
  SectionViolation,
} from "@minion-stack/shared";

/**
 * Error raised when a `prompt.sections.*` call fails.
 * When the gateway returns a `SECTION_VALIDATION_FAILED` error, the
 * `violations` array is populated — callers can render them inline via
 * `ValidationErrors.svelte`. For any other error, `violations` is `undefined`
 * and callers should fall back to a toast.
 */
export class PromptSectionsError extends Error {
  readonly violations?: SectionViolation[];
  readonly raw: unknown;

  constructor(message: string, opts?: { violations?: SectionViolation[]; raw?: unknown }) {
    super(message);
    this.name = "PromptSectionsError";
    this.violations = opts?.violations;
    this.raw = opts?.raw;
  }

  get isValidationError(): boolean {
    return Array.isArray(this.violations) && this.violations.length > 0;
  }
}

/**
 * Normalise arbitrary errors thrown by `sendRequest` into a `PromptSectionsError`.
 * Detects the `SECTION_VALIDATION_FAILED` payload shape and unpacks violations.
 */
function normalizeError(err: unknown): PromptSectionsError {
  if (err instanceof PromptSectionsError) return err;

  // GatewayClient rejects with an Error whose .message holds the server message,
  // and (in newer versions) attaches `.details` / `.code`. Probe both shapes.
  const e = err as
    | {
        message?: string;
        code?: string;
        details?: {
          code?: string;
          message?: string;
          violations?: SectionViolation[];
        };
      }
    | undefined;

  const details = e?.details;
  if (details?.code === "SECTION_VALIDATION_FAILED" && Array.isArray(details.violations)) {
    return new PromptSectionsError(details.message ?? "Section validation failed", {
      violations: details.violations,
      raw: err,
    });
  }

  const message = typeof e?.message === "string" ? e.message : String(err);
  return new PromptSectionsError(message, { raw: err });
}

// ─── 7 typed wrappers ─────────────────────────────────────────────────────────

export async function listSections(agentId: string): Promise<SectionMeta[]> {
  try {
    const res = (await sendRequest("prompt.sections.list", { agentId })) as
      | { sections?: SectionMeta[] }
      | SectionMeta[]
      | null;
    if (Array.isArray(res)) return res;
    return res?.sections ?? [];
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function getSection(agentId: string, sectionId: string): Promise<SectionFull> {
  try {
    const res = (await sendRequest("prompt.sections.get", { agentId, sectionId })) as
      | SectionFull
      | { section?: SectionFull }
      | null;
    if (res && typeof res === "object" && "render" in res) return res as SectionFull;
    const wrapped = (res as { section?: SectionFull } | null)?.section;
    if (!wrapped) throw new Error("prompt.sections.get: empty response");
    return wrapped;
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function upsertSection(
  agentId: string,
  section: SectionInput,
): Promise<SectionMeta> {
  try {
    const res = (await sendRequest("prompt.sections.upsert", { agentId, section })) as
      | SectionMeta
      | { section?: SectionMeta }
      | null;
    if (res && typeof res === "object" && "id" in res) return res as SectionMeta;
    const wrapped = (res as { section?: SectionMeta } | null)?.section;
    if (!wrapped) throw new Error("prompt.sections.upsert: empty response");
    return wrapped;
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function deleteSection(
  agentId: string,
  sectionId: string,
): Promise<{ deleted: boolean }> {
  try {
    const res = (await sendRequest("prompt.sections.delete", { agentId, sectionId })) as
      | { deleted?: boolean }
      | null;
    return { deleted: Boolean(res?.deleted) };
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function previewSections(
  agentId: string,
  mode: PromptMode,
  draftOverride?: { id: string; body: string },
): Promise<PreviewResponse> {
  const params: Record<string, unknown> = { agentId, mode };
  if (draftOverride) params.draftOverride = draftOverride;
  try {
    return (await sendRequest("prompt.sections.preview", params)) as PreviewResponse;
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function getOverrides(agentId: string): Promise<OverridesGetResponse> {
  try {
    const res = (await sendRequest("prompt.sections.overrides.get", { agentId })) as
      | OverridesGetResponse
      | null;
    return { disabled: res?.disabled ?? [] };
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function setOverrides(
  agentId: string,
  disabled: string[],
): Promise<OverridesSetResponse> {
  try {
    const res = (await sendRequest("prompt.sections.overrides.set", {
      agentId,
      disabled,
    })) as OverridesSetResponse | null;
    return { disabled: res?.disabled ?? disabled };
  } catch (e) {
    throw normalizeError(e);
  }
}
