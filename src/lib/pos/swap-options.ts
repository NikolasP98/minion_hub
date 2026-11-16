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
  line: { finProductId: string | null },
): T[] {
  // The server compares CATALOGUE prices (a missing price counts as 0), not
  // the price charged. A retired product is not in this list, so its
  // catalogue price is unknown here: offer nothing rather than guess.
  const current = sellables.find((s) => s.productId === line.finProductId);
  if (!current) return [];
  const price = current.unitPrice ?? 0;
  return sellables.filter(
    (s) =>
      s.kind === 'product' &&
      s.productId !== line.finProductId &&
      Math.abs((s.unitPrice ?? 0) - price) < 0.005,
  );
}
