/**
 * SUNAT resumen diario (RC / `SummaryDocuments`) and comunicación de baja
 * (RA / `VoidedDocuments`) — the two async "ticket" documents that complete
 * the emission library alongside `ubl.ts`'s synchronous `sendBill` Invoice.
 * Structure verified against Greenter's `summary.xml.twig` / `voided.xml.twig`
 * templates (thegreenter/xml on GitHub) — see PR description for source.
 */
import type { EmissionInvoice } from './types';
import { computeTotals } from './ubl';
import { EXTENSION_PLACEHOLDER_XML, escapeXml, signatureBlockXml } from './ubl-common';

function yyyymmdd(dateStr: string): string {
  return dateStr.replaceAll('-', '');
}

/** `RC-YYYYMMDD-N` — YYYYMMDD from the resumen's own IssueDate (submission date). */
export function resumenId(issueDate: string, correlativo: string): string {
  return `RC-${yyyymmdd(issueDate)}-${correlativo}`;
}

/** `RA-YYYYMMDD-N` — YYYYMMDD from the baja's own IssueDate (communication date). */
export function bajaId(issueDate: string, correlativo: string): string {
  return `RA-${yyyymmdd(issueDate)}-${correlativo}`;
}

function supplierBlockXml(ruc: string, razonSocial: string): string {
  return `<cac:AccountingSupplierParty>
<cbc:CustomerAssignedAccountID>${escapeXml(ruc)}</cbc:CustomerAssignedAccountID>
<cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
<cac:Party>
<cac:PartyLegalEntity>
<cbc:RegistrationName>${escapeXml(razonSocial)}</cbc:RegistrationName>
</cac:PartyLegalEntity>
</cac:Party>
</cac:AccountingSupplierParty>`;
}

/** `1` add, `2` modify, `3` anular (void — the boleta-void path; facturas void via `buildBajaXml`). */
export type ResumenEstado = '1' | '2' | '3';

export interface ResumenLine {
  /** The boleta (docType `03`) this line summarizes — totals are derived, not accepted as input. */
  invoice: EmissionInvoice;
  estado: ResumenEstado;
}

export interface ResumenOptions {
  emitter: { ruc: string; razonSocial: string };
  /** Caller-supplied correlativo N for id `RC-YYYYMMDD-N`. */
  correlativo: string;
  /** The boletas' emission date, YYYY-MM-DD. */
  referenceDate: string;
  /** Resumen submission date, YYYY-MM-DD — also the ID's YYYYMMDD component. */
  issueDate: string;
  lines: ResumenLine[];
}

function summaryLineXml(lineId: number, line: ResumenLine): string {
  const inv = line.invoice;
  if (inv.docType !== '03') {
    throw new Error(
      `buildResumenXml: line ${lineId} is docType ${inv.docType} — resumen (RC) covers boletas (03) only`,
    );
  }
  const totals = computeTotals(inv);
  const serieNro = `${inv.serie}-${inv.correlativo}`;
  return `<sac:SummaryDocumentsLine>
<cbc:LineID>${lineId}</cbc:LineID>
<cbc:DocumentTypeCode>${inv.docType}</cbc:DocumentTypeCode>
<cbc:ID>${escapeXml(serieNro)}</cbc:ID>
<cac:AccountingCustomerParty>
<cbc:CustomerAssignedAccountID>${escapeXml(inv.client.docNumber)}</cbc:CustomerAssignedAccountID>
<cbc:AdditionalAccountID>${inv.client.docType}</cbc:AdditionalAccountID>
</cac:AccountingCustomerParty>
<cac:Status>
<cbc:ConditionCode>${line.estado}</cbc:ConditionCode>
</cac:Status>
<sac:TotalAmount currencyID="${inv.currency}">${totals.taxInclusiveAmount.toFixed(2)}</sac:TotalAmount>
<sac:BillingPayment>
<cbc:PaidAmount currencyID="${inv.currency}">${totals.lineExtensionAmount.toFixed(2)}</cbc:PaidAmount>
<cbc:InstructionID>01</cbc:InstructionID>
</sac:BillingPayment>
<cac:TaxTotal>
<cbc:TaxAmount currencyID="${inv.currency}">${totals.igvAmount.toFixed(2)}</cbc:TaxAmount>
<cac:TaxSubtotal>
<cbc:TaxAmount currencyID="${inv.currency}">${totals.igvAmount.toFixed(2)}</cbc:TaxAmount>
<cac:TaxCategory>
<cac:TaxScheme>
<cbc:ID>1000</cbc:ID>
<cbc:Name>IGV</cbc:Name>
<cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
</cac:TaxScheme>
</cac:TaxCategory>
</cac:TaxSubtotal>
</cac:TaxTotal>
</sac:SummaryDocumentsLine>`;
}

/** Builds the unsigned UBL 2.1 `SummaryDocuments` (RC) — resumen diario de boletas. */
export function buildResumenXml(opts: ResumenOptions): string {
  const id = resumenId(opts.issueDate, opts.correlativo);
  const lines = opts.lines.map((l, i) => summaryLineXml(i + 1, l)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1">
${EXTENSION_PLACEHOLDER_XML}
<cbc:UBLVersionID>2.0</cbc:UBLVersionID>
<cbc:CustomizationID>1.1</cbc:CustomizationID>
<cbc:ID>${escapeXml(id)}</cbc:ID>
<cbc:ReferenceDate>${opts.referenceDate}</cbc:ReferenceDate>
<cbc:IssueDate>${opts.issueDate}</cbc:IssueDate>
${signatureBlockXml(opts.emitter.ruc, opts.emitter.razonSocial)}
${supplierBlockXml(opts.emitter.ruc, opts.emitter.razonSocial)}
${lines}
</SummaryDocuments>`;
}

export interface BajaLine {
  /** RA covers facturas (01) only — boletas void via RC estado 3 (`buildResumenXml`), never here. */
  docType: '01';
  serie: string;
  correlativo: string;
  motivo: string;
}

export interface BajaOptions {
  emitter: { ruc: string; razonSocial: string };
  /** Caller-supplied correlativo N for id `RA-YYYYMMDD-N`. */
  correlativo: string;
  /** Date the voided document(s) were originally issued, YYYY-MM-DD. */
  referenceDate: string;
  /** Baja communication date, YYYY-MM-DD — also the ID's YYYYMMDD component. */
  issueDate: string;
  lines: BajaLine[];
}

function voidedLineXml(lineId: number, line: BajaLine): string {
  // Runtime guard alongside the `docType: '01'` literal type — belt and
  // suspenders against an `as any` cast or an untyped JS caller.
  if (line.docType !== '01') {
    throw new Error(
      `buildBajaXml: line ${lineId} is docType ${line.docType} — RA covers facturas (01) only; boletas void via RC estado 3`,
    );
  }
  return `<sac:VoidedDocumentsLine>
<cbc:LineID>${lineId}</cbc:LineID>
<cbc:DocumentTypeCode>${line.docType}</cbc:DocumentTypeCode>
<sac:DocumentSerialID>${escapeXml(line.serie)}</sac:DocumentSerialID>
<sac:DocumentNumberID>${escapeXml(line.correlativo)}</sac:DocumentNumberID>
<sac:VoidReasonDescription>${escapeXml(line.motivo)}</sac:VoidReasonDescription>
</sac:VoidedDocumentsLine>`;
}

/** Builds the unsigned UBL 2.1 `VoidedDocuments` (RA) — comunicación de baja de facturas. */
export function buildBajaXml(opts: BajaOptions): string {
  const id = bajaId(opts.issueDate, opts.correlativo);
  const lines = opts.lines.map((l, i) => voidedLineXml(i + 1, l)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<VoidedDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
${EXTENSION_PLACEHOLDER_XML}
<cbc:UBLVersionID>2.0</cbc:UBLVersionID>
<cbc:CustomizationID>1.0</cbc:CustomizationID>
<cbc:ID>${escapeXml(id)}</cbc:ID>
<cbc:ReferenceDate>${opts.referenceDate}</cbc:ReferenceDate>
<cbc:IssueDate>${opts.issueDate}</cbc:IssueDate>
${signatureBlockXml(opts.emitter.ruc, opts.emitter.razonSocial)}
${supplierBlockXml(opts.emitter.ruc, opts.emitter.razonSocial)}
${lines}
</VoidedDocuments>`;
}
