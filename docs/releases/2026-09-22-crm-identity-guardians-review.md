# CRM identity and guardians release review

**Verdict: PASS**

The final staged source satisfies the requested quick-add, DOB, sex, foreign-document, and legal-guardian behavior without regressing the current POS requirements flow.

- POS quick-add exposes the standard CRM identity/demographic fields and organization custom fields. DNI autofill is explicit, preserves the requested DNI, rejects stale lookup responses, and foreign document types remain authoritative.
- Existing POS customer hydration still returns the released name, phone, document, and verification fields. Guardian contact resolution is additive, requires `crm:view`, applies if-owner scope, and excludes soft-deleted contacts.
- Phone/document/DOB edits and the current configurable POS missing-requirements behavior remain intact after the three-way merge.
- Guardian reads explicitly require `crm:view`; writes retain the CRM write gate, tenancy checks, owner scope, adult eligibility, and same-organization enforcement.
- DOB is stored as a date and rendered through the localized display formatter; the picker uses a native working date control with a local-today maximum.
- Manual/foreign sex remains distinct from registry enrichment and is projected registry-first with manual profile fallback.
- The staged diff contains no conflict markers or whitespace errors. Focused regression evidence reported during review passed for quick-add, resolver/RBAC, owner/deleted contact filtering, and guardian access.

## Source-data limitation

The verified-customer audit found seven verified source records whose provider response did not supply a trustworthy DOB. The repair path must not invent those dates, so DOB remains absent for those records until a reliable source or manual correction is available. This is a source-data limitation, not an implementation failure; complete name/sex coverage and zero production updates are separate from DOB completeness.
