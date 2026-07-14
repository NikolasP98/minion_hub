# UI coherence Wave B route ledger

This ledger records the complete Wave B route-composition pass based on
`86e24cbd`. A checked route either owns its canonical `PageShell` directly or
inherits an explicit pathname-to-archetype contract from its section layout,
with the responsive `SectionShell` retaining the single navigation/content
relationship. Every file changed by the wave has zero governed design-lint
debt; legacy leaf debt that was not edited remains governed by the repository
ratchet rather than being hidden by this ledger.

## Shared section composition

- [x] CRM, Finances, POS, Scheduling, Socials, and Stock layouts use
      `SectionShell mode="responsive"`.
- [x] Their domain navs use `SectionNav`, preserve permission-filtered links,
      and transform from a wide rail to a labelled medium/compact strip.
- [x] `SectionNav` supports nested destinations and persistent operational
      context; POS retains its active-shift footer.
- [x] Workforce retains its previously consolidated responsive section shell.
- [x] Socials, Stock, and Workforce layouts resolve every child pathname to its
      dashboard, collection, record-detail, form, workspace, canvas, or public
      `PageShell` archetype and scroll-owner contract.

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

- [x] `/socials`
- [x] `/socials/campaigns`
- [x] `/socials/campaigns/[campaignId]`
- [x] `/socials/posts`
- [x] `/socials/posts/[postId]`
- [x] `/socials/settings`

### Stock

- [x] `/stock`
- [x] `/stock/commitments`
- [x] `/stock/consume`
- [x] `/stock/consumption`
- [x] `/stock/entries`
- [x] `/stock/entries/[id]`
- [x] `/stock/entries/new`
- [x] `/stock/items`
- [x] `/stock/items/[id]`
- [x] `/stock/warehouses`

### Support

- [x] `/support`
- [x] `/support/[id]`

### Work

- [x] `/work`

### Workforce

- [x] `/workforce`
- [x] `/workforce/activity`
- [x] `/workforce/agents/[id]`
- [x] `/workforce/approvals`
- [x] `/workforce/costs`
- [x] `/workforce/goals`
- [x] `/workforce/inbox`
- [x] `/workforce/issues`
- [x] `/workforce/issues/[id]`
- [x] `/workforce/org`
- [x] `/workforce/portfolios`
- [x] `/workforce/portfolios/[id]`
- [x] `/workforce/projects`
- [x] `/workforce/projects/[id]`
- [x] `/workforce/projects/[id]/pipelines`
- [x] `/workforce/reliability`
- [x] `/workforce/settings`
- [x] `/workforce/settings/agents`
- [x] `/workforce/welcome`

## Remaining visual evidence

Run the authenticated compact/medium/wide route matrix and attach visual
evidence once the local deterministic auth tenant is available. This is an
environment prerequisite for capture evidence, not an unchecked route or
composition contract.

Every continuation slice uses `--zero-changed --base-ref 86e24cbd`; genuine
data-visualization exceptions must be narrowly reason-coded rather than used to
waive product UI debt.
