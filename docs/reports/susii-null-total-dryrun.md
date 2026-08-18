# SUSII null-total backfill — DRY RUN (no writes)

org: `21e0601b-f632-43fd-8414-d644af4271f4` · formula: `items + tax − discount + other_charges + rounding`

## Calibration guard

Formula re-checked against **2330** invoices whose total is already known: **0 mismatches**.

## Summary

|                                           |                   |
| ----------------------------------------- | ----------------: |
| invoices with NULL total                  |              1497 |
| …of those, with NO line items (stay NULL) |                 0 |
| **rows this backfill would update**       |          **1497** |
| **revenue recovered**                     | **S/ 1233382.94** |

## By month

| month   | rows | revenue recovered |
| ------- | ---: | ----------------: |
| 2024-01 |   35 |          34920.04 |
| 2024-02 |   47 |          42040.07 |
| 2024-03 |   39 |          34850.05 |
| 2024-04 |   30 |          25170.03 |
| 2024-05 |   37 |          39928.06 |
| 2024-06 |   37 |          45930.07 |
| 2024-07 |    1 |            990.00 |
| 2024-08 |    2 |            889.00 |
| 2024-11 |    1 |            500.00 |
| 2024-12 |   40 |          41589.93 |
| 2025-01 |   27 |          26064.94 |
| 2025-02 |   23 |          19829.98 |
| 2025-03 |   55 |          48014.99 |
| 2025-04 |  107 |          46114.15 |
| 2025-05 |   89 |          43600.10 |
| 2025-06 |   58 |          50494.98 |
| 2025-07 |  108 |          81858.96 |
| 2025-08 |   50 |          41247.04 |
| 2025-09 |   65 |          51390.55 |
| 2025-10 |   71 |          49760.11 |
| 2025-11 |  109 |          73796.56 |
| 2025-12 |  113 |          90930.15 |
| 2026-01 |   77 |          61470.11 |
| 2026-02 |   76 |          53000.14 |
| 2026-03 |   51 |          55622.54 |
| 2026-04 |   48 |          51630.09 |
| 2026-05 |   41 |          47584.09 |
| 2026-06 |   29 |          30300.08 |
| 2026-07 |   31 |          43866.10 |

## 25 largest rows

| number | date (Lima)      | client                         | before |   after |
| ------ | ---------------- | ------------------------------ | -----: | ------: |
| 2922   | 2026-02-07 12:41 | PUENTE GUEVARA LUCIANA ALESSAN |   NULL | 5590.00 |
| 3774   | 2026-07-11 17:33 | LOYOLA VALVERDE MARIA CRISTINA |   NULL | 5500.00 |
| 2146   | 2025-10-14 11:44 | GRANDE ZAVALA ERIKA FABIOLA    |   NULL | 5350.00 |
| 3724   | 2026-07-04 14:07 | MEZA PORRAS ZAYRA NIKOL        |   NULL | 4700.01 |
| 193    | 2024-06-01 13:36 | Rosario Perez Ramos            |   NULL | 4490.00 |
| 2822   | 2026-01-21 18:25 | GUILLEN AYBAR NICOLE ANDREA    |   NULL | 4350.00 |
| 2818   | 2026-01-20 12:26 | GILIO ZUÑIGA YAMILETH ANGELICA |   NULL | 4250.00 |
| 2580   | 2025-12-15 20:16 | GUERRA SILVERIO CARMEN         |   NULL | 4240.00 |
| 2221   | 2025-10-31 12:16 | MARTINEZ ESPINOZA ANA ROSA     |   NULL | 4200.00 |
| 2372   | 2025-11-24 20:52 | RABANAL ALIAGA MARIAM DEL ROSA |   NULL | 4190.00 |
| 890    | 2025-04-04 18:30 | TTUPA MAMANI GABRIEL SERVANDO  |   NULL | 3900.00 |
| 1786   | 2025-08-19 12:03 | NAVARRO JIMENEZ FIORELA        |   NULL | 3890.00 |
| 2370   | 2025-11-24 20:33 | MATA DOÑE HANNYA ALDANA        |   NULL | 3810.00 |
| 2624   | 2025-12-20 12:43 | MURILLO CARHUANINA NEELYM GIOV |   NULL | 3800.00 |
| 2748   | 2026-01-10 11:40 | MORENO ZAMORA YAMILE ANDREA    |   NULL | 3640.00 |
| 2034   | 2025-09-27 11:56 | QUEZADA GUEVARA ALFONSO PAULIN |   NULL | 3590.00 |
| 1111   | 2025-05-21 20:10 | CHUQUIYAURI PAREJA CINTHYA IVO |   NULL | 3550.00 |
| 1277   | 2025-06-21 13:34 | AMARO LLANOS KATIA MILENA      |   NULL | 3400.00 |
| 165    | 2024-05-10 18:09 | Leyla Diaz                     |   NULL | 3360.00 |
| 3078   | 2026-03-13 19:28 | ALARCO CAMPOS ALEXANDRA SIU CH |   NULL | 3330.00 |
| 28     | 2024-01-18 20:02 | Jenny Herrera                  |   NULL | 3300.00 |
| 2564   | 2025-12-14 00:14 | FLORES SIANCAS MERY ELVIRA     |   NULL | 3300.00 |
| 2649   | 2025-12-23 14:34 | BAZAN DURAND DANIEL ANTONIO    |   NULL | 3300.00 |
| 2190   | 2025-10-24 20:46 | ROMAN VICENTE ANA CLAUDIA      |   NULL | 3250.00 |
| 1154   | 2025-05-31 14:42 | RODRIGUEZ MELCHOR CRISTHEL CAR |   NULL | 3250.00 |

## Rows that would stay NULL (no line items to price)

_none — every null-total invoice has line items._
