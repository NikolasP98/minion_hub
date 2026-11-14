/** Products a sale line can be swapped to (meta spec 120, S4): active
 *  products at the same catalogue price as the one on the line. The server
 *  refuses anything else (`price_differs`), so the list never offers it. */
export interface SwapCandidate {
  productId: string;
  name: string;
  kind: string;
  unitPrice: number | null;
}

export function swapOptions<T extends SwapCandidate>(
  sellables: readonly T[],
  line: { finProductId: string | null; unitPrice: string | number | null },
): T[] {
  const current = sellables.find((s) => s.productId === line.finProductId);
  // A retired product is not in the list: fall back to the price charged.
  const price = current?.unitPrice ?? Number(line.unitPrice ?? NaN);
  return sellables.filter(
    (s) =>
      s.kind === 'product' &&
      s.productId !== line.finProductId &&
      s.unitPrice != null &&
      Math.abs(s.unitPrice - price) < 0.005,
  );
}
