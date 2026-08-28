# SUNAT API Reference

Quick-access reference for the SUNAT integration in this directory:
`connectors/sunat-sire-*` (SIRE reads), `emission/*` (SEE emission),
`../services/purchases.service.ts` (RCE compras). Everything below was
verified live against FACES SCULPTORS (RUC 20611172967) in Aug 2026 unless
marked otherwise. **Check the official docs before changing endpoints — SUNAT
revises the manuals (v22 as of this writing).**

## Official documentation (authoritative)

| Doc                                                 | URL                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SIRE — formas de acceso / API credentials           | https://cpe.sunat.gob.pe/node/158                                                                                                      |
| SIRE **Ventas** (RVIE) Web API manual v22           | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20Ventas%20v22_Parte%20I.pdf             |
| SIRE **Compras** (RCE) Web API manual v22 — Parte I | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v22.pdf             |
| …RCE Parte II (ajustes posteriores)                 | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v22_Parte%20II.pdf  |
| …RCE Parte III (FV0621 etc.)                        | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v22_Parte%20III.pdf |
| UBL 2.1 XML guide — **Factura**                     | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+factura+version%202-1+1+0%20(2)_0%20(2).pdf                         |
| UBL 2.1 XML guide — **Boleta**                      | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+boleta+version%202-1+1+0_0_0%20(2).pdf                              |
| UBL 2.1 XML guide — **Nota de Crédito**             | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+nota%20de%20cr%C3%A9dito+version%202-1+1+0_0_0%20(2).pdf            |
| UBL 2.1 XML guide — **Nota de Débito**              | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+nota%20de%20d%C3%A9bito+version%202-1+1+0_0_0%20(2).pdf             |
| Beta test service notice (UBL 2.1)                  | https://cpe.sunat.gob.pe/noticias/servicio-beta-para-realizar-pruebas-ubl-21                                                           |
| SOAP web services overview (Greenter, community)    | https://fe-primer.greenter.dev/docs/webservices/                                                                                       |
| Reference impl for UBL shapes (Greenter, PHP)       | https://greenter.dev/ · https://github.com/thegreenter/xml                                                                             |

Local copy of the RCE Compras manual (read with the Read tool, `pages:`):
`~/.claude/projects/-home-nikolas-Documents-CODE-MINION/e34f11ab-6b62-44b6-a367-057b7e076ba7/tool-results/webfetch-1786740239447-x7yop3.pdf`

Legal basis: RS 112-2021/SUNAT + modificatorias (comprobante type table),
RS 117-2017 (UBL fields), RS 040/286-2022 (SIRE obligación).

## Auth — OAuth2 password grant (all REST APIs)

```
POST https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/
Content-Type: application/x-www-form-urlencoded
grant_type=password & scope=https://api-sire.sunat.gob.pe
  & client_id=<uuid> & client_secret=<...>
  & username=<RUC><SOL_USER>   (concatenated, e.g. 20611172967NIKO1998)
  & password=<SOL_clave>
```

Returns `{access_token, expires_in}` (~3600s JWT). Bearer it on every call.
**client_id/secret** come from SOL → _Credenciales de API SUNAT → Gestión_ —
there is **ONE app per RUC**; FACES reuses the accountant's "STARSOFT" app
(never regenerate its clave). Secret has a lowercase L, not a capital I.

<<<<<<< HEAD
=======
### Tenant configuration and live probe

Store one `fin_sources.provider='sunat-sire'` row per organization. Keep the
RUC, legal name, address, ubigeo, client ID, and optional backfill period in
`config`. Store the SOL user, SOL password, and client secret only in the
encrypted `secret_refs` envelope. Never return `secret_refs` to the browser.

`POST /api/finances/sources/probe` decrypts the stored credentials on the
server, obtains an OAuth token, and calls the read-only periods endpoint once.
It records only `last_probe_at`, `last_probe_status`, and a bounded non-secret
message. The probe never presents, acknowledges, or changes a SUNAT book.

>>>>>>> origin/master
## SIRE reads — `sunat-sire-client.ts`

Base `https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros`. Book code:
**140000 = RVIE (ventas)**, **080000 = RCE (compras)**.

- Periods: `GET /rvierce/padron/web/omisos/{codLibro}/periodos` → ejercicios →
  `lisPeriodos[]` with `desEstado` `Presentado` (CLOSED) / `No Presentado` (OPEN).
- RVIE propuesta rows (paged JSON): `GET /rvie/propuesta/web/propuesta/{per}/comprobantes?page=&perPage=&mostrarDetalle=1`
  → `{paginacion{totalRegistros}, registros[], totales}`. Params are `page`/`perPage`
  (a 422 lists any missing field). Works for presented periods too.
- RCE resumen (synchronous CSV): `GET /rvierce/resumen/web/resumencomprobantes/{per}/{tipoResumen}/{tipoArchivo}/exporta?codLibro=080000`
  (tipoResumen 1=propuesta). Returns per-doc-type aggregate CSV.
- RCE row export (async): `GET /rce/propuesta/web/propuesta/{per}/exportacioncomprobantepropuesta?codTipoArchivo=0&codOrigenEnvio=2`
  → `{numTicket}`; status `GET /rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets?perIni=&perFin=&page=1&perPage=20&numTicket=`
  → `archivoReporte[].nomArchivoReporte`; download `GET /rvierce/gestionprocesosmasivos/web/masivo/archivoreporte?nomArchivoReporte=&codTipoArchivoReporte=`.

### ⚠️ Known SUNAT-side quirks (learned the hard way)

- **`api-sire` fileserver is user-agent-gated**: default curl / HeadlessChrome →
  500 or TCP reset; send a browser `User-Agent` + `--http1.1`.
- **RCE `archivoreporte` download is broken server-side**: every request rewrites
  to an internal path with a stray `/e/` segment
  (`.../gestionprocesosmasivos/web/e/masivo/archivoreporte`) and 500s. The public
  API cannot currently return RCE row files. Workaround in use: parse the resumen
  CSV (per-doc-type aggregates). **Row-level detail is reachable only via the SIRE
  _web app's_ own backend** — a separate host `e-factura.sunat.gob.pe/app/contribuyentems/servicio/librocompras/mige/...`,
  NOT `api-sire`. Capturing that endpoint (cross-origin iframe, needs CDP target
  auto-attach) is the open follow-up.
- There is **no** paged-JSON `comprobantes` endpoint for RCE (RVIE-only).

## SEE emission (SOAP) — `emission/*`

<<<<<<< HEAD
=======
Shadow emission reads the emitter identity from the active organization's
`sunat-sire` source. It must never fall back to a process-global RUC or another
organization's configuration.

>>>>>>> origin/master
- Beta (sandbox, no cert): `https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService`
  — WS-Security UsernameToken `<RUC>MODDATOS` / `MODDATOS`.
- Prod: `https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService` (needs a real
  X.509 certificado digital tributario issued to the RUC).
- Methods: `sendBill` (facturas/notas, sync → CDR), `sendSummary` (boletas via
  **resumen diario**, + comunicación de baja → ticket), `getStatus` (poll ticket:
  0=done+CDR, 98=in-process, 99=error+CDR), `getStatusCdr` (re-fetch a CDR).
- Doc lifecycle proven in beta: emit → resumen → anular(estado 3) → baja(RA).
  Boletas void via resumen estado 3; facturas via `VoidedDocuments` (RA).
  **Comunicación de baja window = 7 calendar days** from the CDR.

### Emission quirks

- RSA-SHA1 digest/signature accepted (SHA256 not required in beta).
- Beta gateway rate-limits back-to-back calls → plain nginx **401** (not a SOAP
  fault); space calls ~3s.
- Factura needs a `cac:PaymentTerms` (FormaPago/Contado) block or SUNAT faults
  `3244`; also a `cac:Signature` referencing `#SignatureSP`.
- Escaped text nodes only — never wrap escaped text in CDATA (double-encodes).
- `SOAPAction: ''` (empty) is accepted.

## Not yet built / deferred

- RCE **write** endpoints (aceptar/reemplazar/registrar preliminar, ajustes
  posteriores — manual §5.2–5.29): they mutate the accountant's live workspace.
  Deferred pending accountant coordination; `fin_purchases.sync_state='diverged'`
  is the hook for the eventual push leg.
- Production emission: needs the real certificate + fresh series (keep BE01/etc.
  for SUSII history; new emitter gets its own serie).
<<<<<<< HEAD

## Production certificate (Certificado Digital Tributario — CDT)

Free from SUNAT, 3-yr validity, program open until 31-Dec-2027, and explicitly
valid for **SEE Del Contribuyente** (our emission path). SOL path (likely needs
the PRINCIPAL Clave SOL): **Empresas → Comprobantes de Pago → Certificado
Digital Tributario - CDT → Solicitar Certificado Digital Tributario** → accept
terms → set an 8+ char alphanumeric private-key password (unrecoverable) →
download `certificado.p12` from the Buzón message "Emisión de Certificado
Digital Tributario". Convert: `openssl pkcs12 -in certificado.p12 -clcerts
-nokeys -out cert.pem` and `... -nocerts -nodes -out key.pem`; store as the prod
equivalents of `POS_EMISSION_BETA_CERT/KEY` env vars (never commit).
Eligibility caveats to verify: 2019 net income ≤ S/ 1,260,000 (regulation pins
to FY2019); no existing valid CDT (max 2 ever) — FACES may already hold one via
SUSII that could be reused. Fallback: commercial INDECOPI-accredited CA (~S/
80-200/yr). Docs: https://cpe.sunat.gob.pe/certificado-digital ·
https://www.gob.pe/26725-obtener-certificado-digital-tributario
=======
>>>>>>> origin/master
