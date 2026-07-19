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

export interface WizardMode {
    /** Steps shown in the stepper, in order. */
    steps: ('connect' | 'name' | 'assign')[];
    /** Whether the user picks a DM policy; when false, `dmPolicy` is forced. */
    asksDmPolicy: boolean;
    /** Effective DM policy when `asksDmPolicy` is false. */
    dmPolicy: 'open' | 'pairing' | 'disabled';
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
