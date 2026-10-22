/** Channel setup wizard — intent modes.
 *
 * The wizard's TRIGGER carries the intent: an operator wiring up a business channel
 * needs reply routing (DM policy + agent assignment); a person connecting their own
 * number does not — for them the only sane DM policy is "off", which makes the assign
 * step a no-op that only creates doubt.
 *
 * Adding a third context should be one entry here, not a new branch in the component.
 * Spec: specs/2026-07-19-channel-wizard-intent-modes.md
 */

export type WizardIntent = 'operator' | 'personal';

export type WizardStep = 'connect' | 'name' | 'assign' | 'sync';

/** 'members' (WhatsApp): closed to the public; verified org members reach their own
 *  assistant (spec 032 — replies:'bound', allowFrom:[], settings.memberAgents). */
export type DmPolicy = 'members' | 'open' | 'pairing' | 'disabled';

export interface WizardMode {
  /** Steps shown in the stepper, in order. */
  steps: WizardStep[];
  /** Whether the user picks a DM policy; when false, `dmPolicy` is forced. */
  asksDmPolicy: boolean;
  /** Effective DM policy when `asksDmPolicy` is false. */
  dmPolicy: DmPolicy;
  /** Claims the account for the acting user (user-scoped, follows them across orgs).
   *  The server derives the profile id from the session — this only declares intent. */
  personal: boolean;
}

export const WIZARD_INTENTS: Record<WizardIntent, WizardMode> = {
  operator: {
    steps: ['connect', 'name', 'assign'],
    asksDmPolicy: true,
    dmPolicy: 'open',
    personal: false,
  },
  personal: {
    steps: ['connect', 'name'],
    asksDmPolicy: false,
    dmPolicy: 'disabled', // → replies:'none', allowFrom:[] — sync only, never auto-reply
    personal: true,
  },
};

/**
 * Channels whose work CONTINUES after pairing — they get a terminal Sync step.
 * WhatsApp hands its history over from the phone in chunks for minutes after
 * the link succeeds, so ending the wizard at "paired" reports the start of the
 * job as if it were the end. Adding a channel here is the whole change.
 */
export const SYNC_STEP_CHANNELS: readonly string[] = ['whatsapp'];

/** Channels that support the members-only mode. */
export const MEMBER_MODE_CHANNELS: readonly string[] = ['whatsapp'];

/** Default DM policy: a business number an org provisions starts closed to the public,
 *  with its members talking to their own assistant (owner default, spec 032). */
export function defaultDmPolicy(intent: WizardIntent, channelType: string): DmPolicy {
  if (intent === 'operator' && MEMBER_MODE_CHANNELS.includes(channelType)) return 'members';
  return WIZARD_INTENTS[intent].dmPolicy;
}

/** The step list for this intent + channel — data, not a branch in the component. */
export function wizardSteps(intent: WizardIntent, channelType: string): WizardStep[] {
  const base = WIZARD_INTENTS[intent].steps;
  return SYNC_STEP_CHANNELS.includes(channelType) ? [...base, 'sync'] : [...base];
}
