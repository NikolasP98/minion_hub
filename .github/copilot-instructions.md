# Copilot instructions

## Code review

This repo's PRs are reviewed by multiple agents (Claude "thermonuclear" review
plus a software-factory triage agent that decides apply/dismiss per finding
before anything merges). Make findings triageable:

- Prefix every finding with a severity: Critical / High / Medium / Low.
- Cite a concrete `file:line` for every claim.
- Before style or idiom suggestions, check how the surrounding code and
  sibling modules already do it — consistency with the local idiom outranks
  general preferences. If the codebase already uses the pattern you are about
  to flag, don't flag it.
- PRs titled `train: promote …` are scheduled promotions of already-reviewed
  work. Review the promotion diff for release safety (config, migrations, env,
  CI) rather than re-litigating feature internals.
