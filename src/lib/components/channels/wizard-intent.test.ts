import { describe, it, expect } from 'vitest';
import { WIZARD_INTENTS } from './wizard-intent';

describe('WIZARD_INTENTS', () => {
    it('operator is unchanged: 3 steps, asks DM policy, org-scoped', () => {
        expect(WIZARD_INTENTS.operator).toEqual({
            steps: ['connect', 'name', 'assign'],
            asksDmPolicy: true,
            dmPolicy: 'open',
            personal: false,
        });
    });

    it('personal drops the assign step and never asks DM policy', () => {
        const mode = WIZARD_INTENTS.personal;
        expect(mode.steps).toEqual(['connect', 'name']);
        expect(mode.steps).not.toContain('assign');
        expect(mode.asksDmPolicy).toBe(false);
    });

    it('personal forces DMs off — a personal number must never auto-reply', () => {
        // 'disabled' is what ChannelSetupWizard.accessFieldsFor maps to
        // { replies: 'none', allowFrom: [] } — sync only.
        expect(WIZARD_INTENTS.personal.dmPolicy).toBe('disabled');
    });

    it('only the personal intent claims the account for a user', () => {
        expect(WIZARD_INTENTS.personal.personal).toBe(true);
        expect(WIZARD_INTENTS.operator.personal).toBe(false);
    });
});
