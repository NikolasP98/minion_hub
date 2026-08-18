# DNI Identity Validation — Backfill Report

**Date:** 2026-07-15
**Org:** FACES SCULPTORS (`21e0601b-f632-43fd-8414-d644af4271f4`)
**Source:** PERUDEVS "Consulta DNI Completo" API
**Scope:** every person party whose `doc_number` is exactly 8 integer characters (real DNIs). Non-conforming documents (RUC, sentinels, short/long) were skipped so no API budget was wasted on them.

## Validation results

| Outcome                                                   | Count    |
| --------------------------------------------------------- | -------- |
| **Validated (identity confirmed)**                        | **2026** |
| Wrong DNI (queried ID does not match the customer's data) | 42       |
| Not found in the public registry                          | 20       |
| **Total 8-digit DNIs processed**                          | **2088** |

Validated = the registry returned a person AND their name matched the CRM record (order-insensitive, accent/Ñ-folded). Those parties carry `dni_verified = true`.

## Identity enrichment (validated parties)

Every one of the 2026 validated parties had its registry data written back:

| Field             | Coverage                    | Notes                                                                                                                                                  |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Date of birth** | 2019 / 2026                 | Stored as a real `date`; age is derived from it live. The 7 without a DOB have an empty birth date in the registry itself.                             |
| **Sex**           | 2026 / 2026 (221 M, 1805 F) | Stored canonical `M`/`F`; the UI localizes to Hombre/Mujer.                                                                                            |
| **Full name**     | 2026 / 2026                 | Rebuilt from the registry's structured parts as `nombres apellido_paterno apellido_materno`, overwriting both the party name and the CRM display name. |

The raw registry payload (names, sex, verification code) is retained in `metadata.dni_registry` as an audit trail, so the name can be re-ordered later without re-querying.

Per requirement, this report intentionally omits all personal details — only aggregate counts.

## Ongoing mechanism

Validation and enrichment are not one-off. New CRM entries (site leads, SUSII sync, manual creates) are picked up automatically by the hourly cron tick `GET /api/crm/dni-validation/tick`, which validates up to 25 pending 8-digit DNIs per org per run and enriches each newly-verified party with the same name/sex/DOB data. The verified state is also a toggleable checkmark column in the CRM customers table for manual override.
