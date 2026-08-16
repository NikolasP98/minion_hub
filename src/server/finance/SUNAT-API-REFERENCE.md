# SUNAT API Reference

Quick-access reference for the SUNAT integration in this directory:
`connectors/sunat-sire-*` (SIRE reads), `emission/*` (SEE emission),
`../services/purchases.service.ts` (RCE compras). Everything below was
verified live against FACES SCULPTORS (RUC 20611172967) in Aug 2026 unless
marked otherwise. **Check the official docs before changing endpoints — SUNAT
revises the manuals (v22 as of this writing).**

## Official documentation (authoritative)

| Doc | URL |
|---|---|
| SIRE — formas de acceso / API credentials | https://cpe.sunat.gob.pe/node/158 |
| SIRE **Ventas** (RVIE) Web API manual v22 | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20Ventas%20v22_Parte%20I.pdf |
| SIRE **Compras** (RCE) Web API manual v22 — Parte I | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v22.pdf |
| …RCE Parte II (ajustes posteriores) | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v22_Parte%20II.pdf |
| …RCE Parte III (FV0621 etc.) | https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v22_Parte%20III.pdf |
| UBL 2.1 XML guide — **Factura** | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+factura+version%202-1+1+0%20(2)_0%20(2).pdf |
| UBL 2.1 XML guide — **Boleta** | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+boleta+version%202-1+1+0_0_0%20(2).pdf |
| UBL 2.1 XML guide — **Nota de Crédito** | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+nota%20de%20cr%C3%A9dito+version%202-1+1+0_0_0%20(2).pdf |
| UBL 2.1 XML guide — **Nota de Débito** | https://cpe.sunat.gob.pe/sites/default/files/inline-files/guia+xml+nota%20de%20d%C3%A9bito+version%202-1+1+0_0_0%20(2).pdf |
| Beta test service notice (UBL 2.1) | https://cpe.sunat.gob.pe/noticias/servicio-beta-para-realizar-pruebas-ubl-21 |
| SOAP web services overview (Greenter, community) | https://fe-primer.greenter.dev/docs/webservices/ |
| Reference impl for UBL shapes (Greenter, PHP) | https://greenter.dev/ · https://github.com/thegreenter/xml |

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
**client_id/secret** come from SOL → *Credenciales de API SUNAT → Gestión* —
there is **ONE app per RUC**; FACES reuses the accountant's "STARSOFT" app
(never regenerate its clave). Secret has a lowercase L, not a capital I.

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
  *web app's* own backend** — a separate host `e-factura.sunat.gob.pe/app/contribuyentems/servicio/librocompras/mige/...`,
  NOT `api-sire`. Capturing that endpoint (cross-origin iframe, needs CDP target
  auto-attach) is the open follow-up.
- There is **no** paged-JSON `comprobantes` endpoint for RCE (RVIE-only).

## SEE emission (SOAP) — `emission/*`

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
