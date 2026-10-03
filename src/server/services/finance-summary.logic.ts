import { netAfterDeductions } from '$lib/finance/revenue-metrics';

/** Derived metrics share one explicit live-document population. Voids are
 * measured against all documents, while sales averages use live invoices. */
export function financeSummaryMetrics(input: {
  net: number;
  gross: number;
  discount: number;
  tax: number;
  cogs: number;
  invoices: number;
  voids: number;
}) {
  const { net, gross, discount, tax, cogs, invoices, voids } = input;
  const grossEffective = gross > 0 ? gross : net + discount;
  // A loss is economic data. Never clamp it to a misleading break-even value.
  const netRevenue = netAfterDeductions(net, tax, cogs);
  return {
    totalGross: grossEffective,
    discountRate: grossEffective > 0 ? discount / grossEffective : 0,
    taxRate: net > 0 ? tax / net : 0,
    netRevenue,
    // Nonpositive sales have no meaningful percentage margin; the signed
    // absolute result above remains available to the user.
    marginRate: net > 0 ? netRevenue / net : 0,
    avgTicket: invoices > 0 ? net / invoices : 0,
    voidRate: invoices + voids > 0 ? voids / (invoices + voids) : 0,
  };
}
