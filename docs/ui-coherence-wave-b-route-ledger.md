# UI coherence Wave B route ledger

This ledger records the reviewable first Wave B slice based on `86e24cbd`. It is
not a claim that the Business Operations wave is complete. A checked route has
the canonical page shell/archetype, a stable heading relationship, semantic
controls/tokens in the changed file, intentional compact/medium/wide behavior,
and zero governed design-lint debt. Unchecked routes remain scheduled Wave B
work and must not be marked migrated merely by inheriting the section shell.

## Shared section composition

- [x] CRM, Finances, POS, Scheduling, Socials, and Stock layouts use
      `SectionShell mode="responsive"`.
- [x] Their domain navs use `SectionNav`, preserve permission-filtered links,
      and transform from a wide rail to a labelled medium/compact strip.
- [x] `SectionNav` supports nested destinations and persistent operational
      context; POS retains its active-shift footer.
- [x] Workforce retains its previously consolidated responsive section shell.

## Routes

### CRM

- [x] `/crm`
- [x] `/crm/[contactId]`
- [x] `/crm/customers`
- [x] `/crm/insights`
- [x] `/crm/settings`

### Finances

- [x] `/finances`
- [x] `/finances/invoices`
- [x] `/finances/invoices/[id]`
- [x] `/finances/products`
- [x] `/finances/settings`

### Memberships

- [x] `/memberships`

### POS

- [x] `/pos/appointments`
- [x] `/pos/catalog`
- [x] `/pos/refills`
- [x] `/pos/sell`

### Sales

- [x] `/sales`
- [x] `/sales/[id]`

### Scheduling

- [x] `/scheduling`
- [x] `/scheduling/bookings`
- [x] `/scheduling/calendar`
- [x] `/scheduling/event-types`
- [x] `/scheduling/links`
- [x] `/scheduling/reminders`
- [x] `/scheduling/resources`
- [x] `/scheduling/settings`

### Socials

- [ ] `/socials`
- [ ] `/socials/campaigns`
- [x] `/socials/campaigns/[campaignId]`
- [ ] `/socials/posts`
- [ ] `/socials/posts/[postId]`
- [ ] `/socials/settings`

### Stock

- [ ] `/stock`
- [ ] `/stock/commitments`
- [ ] `/stock/consume`
- [ ] `/stock/consumption`
- [ ] `/stock/entries`
- [ ] `/stock/entries/[id]`
- [ ] `/stock/entries/new`
- [x] `/stock/items`
- [ ] `/stock/items/[id]`
- [ ] `/stock/warehouses`

### Support

- [x] `/support`
- [x] `/support/[id]`

### Work

- [x] `/work`

### Workforce

- [x] `/workforce`
- [ ] `/workforce/activity`
- [ ] `/workforce/agents/[id]`
- [ ] `/workforce/approvals`
- [ ] `/workforce/costs`
- [ ] `/workforce/goals`
- [ ] `/workforce/inbox`
- [ ] `/workforce/issues`
- [ ] `/workforce/issues/[id]`
- [ ] `/workforce/org`
- [ ] `/workforce/portfolios`
- [ ] `/workforce/portfolios/[id]`
- [ ] `/workforce/projects`
- [ ] `/workforce/projects/[id]`
- [ ] `/workforce/projects/[id]/pipelines`
- [ ] `/workforce/reliability`
- [ ] `/workforce/settings`
- [ ] `/workforce/settings/agents`
- [ ] `/workforce/welcome`

## Continuation order

1. High-debt correctness surfaces: CRM contact/settings, Finance invoice detail,
   POS appointments/sell, Scheduling bookings, and Workforce project/pipeline
   editors.
2. Remaining collection/detail pairs in CRM, Finance, Sales, Support, Socials,
   and Stock.
3. Scheduling calendar/resources/event types/links/reminders, preserving the
   already-landed safe mutation behavior in resources.
4. Workforce activity, approvals, costs, goals, inbox, issues, organization,
   portfolios, projects, reliability, settings, and welcome surfaces.
5. Run the authenticated compact/medium/wide route matrix and attach visual
   evidence once the local deterministic auth tenant is available.

Every continuation slice uses `--zero-changed --base-ref 86e24cbd`; genuine
data-visualization exceptions must be narrowly reason-coded rather than used to
waive product UI debt.
