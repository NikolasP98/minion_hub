# Requirements: Minion Hub v5.0 AI-Native Builder UX

**Defined:** 2026-03-31
**Core Value:** Skill authors can build agent skills effortlessly through an AI-native builder that feels like "tipping a balanced boulder"

## v5.0 Requirements

### Layout Restructure (Phase 13 — SHIPPED)

- [x] **LAYOUT-01**: Agent settings panel renders as 680px two-column drawer with left nav and right content
- [x] **LAYOUT-02**: Agent skills use toggle switches with search and filter tabs instead of drag-and-drop
- [x] **LAYOUT-03**: Overridden settings fields show persistent left-border accent indicator
- [x] **LAYOUT-04**: Skill editor renders as sidebar (280px) + DAG canvas + optional drawer (380px)
- [x] **LAYOUT-05**: Chapter editor renders as inline 380px drawer with progressive disclosure (advanced fields behind chevron)
- [x] **LAYOUT-06**: Empty skill editor shows first-visit description prompt guiding users to AI build
- [x] **LAYOUT-07**: DAG nodes show inline validation indicators (warning/error) without opening validation panel

### AI-Native Interactions (Phase 14)

- [ ] **AI-01**: Each chapter text field (description, guide, context, outputDef) has a wand icon that AI-fills that specific field based on skill context
- [ ] **AI-02**: As user types a skill description (10+ chars), ghost chapter title suggestions appear below as faded pills, accepting one triggers AI generation for that chapter
- [ ] **AI-03**: AI-generated chapters appear as a staged proposal overlay on the DAG with per-node accept/reject controls before committing to the graph
- [ ] **AI-04**: After AI chapter generation, tools are pre-selected per chapter based on description match, shown as "suggested" chips the user can confirm or remove
- [ ] **AI-05**: The suggest-skill API endpoint accepts a `currentGraph` parameter so AI generation is incremental (adds to existing chapters, not replaces)

### Visual Polish (Phase 15)

- [ ] **VIS-01**: Skill cards on listing page show a segmented SVG completion arc indicating readiness (name, description, chapters, tools)
- [ ] **VIS-02**: AI-generated chapters appear with a staggered node-by-node reveal animation (150ms apart) during generation
- [ ] **VIS-03**: A template shelf with 4-6 starter skill templates appears at skill creation, pre-filling name/desc and triggering AI chapter generation

## v6.0 Requirements (Future)

### Conversational Builder

- **CONV-01**: Split-view conversational mode with chat left + graph right for building skills via natural language
- **CONV-02**: Slash commands in text fields (/expand, /add chapter, /tools) for inline AI actions

### Advanced Features

- **ADV-01**: Skill versioning with diff view between versions
- **ADV-02**: Dry-run preview showing simulated chapter outputs on DAG nodes
- **ADV-03**: Condition insertion by right-clicking an edge (instead of separate creation flow)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Conversational builder | High complexity — defer to v6.0 |
| Skill runtime execution engine | Gateway-side, not hub |
| Multi-tenant skill sharing | Future feature beyond current scope |
| Real-time collaborative editing | Single-user builder, unnecessary complexity |
| Full undo/redo system | Would require command pattern across all operations |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAYOUT-01 | Phase 13 | Complete |
| LAYOUT-02 | Phase 13 | Complete |
| LAYOUT-03 | Phase 13 | Complete |
| LAYOUT-04 | Phase 13 | Complete |
| LAYOUT-05 | Phase 13 | Complete |
| LAYOUT-06 | Phase 13 | Complete |
| LAYOUT-07 | Phase 13 | Complete |
| AI-01 | Phase 14 | Pending |
| AI-02 | Phase 14 | Pending |
| AI-03 | Phase 14 | Pending |
| AI-04 | Phase 14 | Pending |
| AI-05 | Phase 14 | Pending |
| VIS-01 | Phase 15 | Pending |
| VIS-02 | Phase 15 | Pending |
| VIS-03 | Phase 15 | Pending |

**Coverage:**
- v5.0 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 after initial definition*
