/** Signed realized revenue; a cost-heavy period must remain visible as a loss. */
export function netAfterDeductions(revenue: number, tax: number, cost: number): number {
  return revenue - tax - cost;
}

export function revenueBandValues(
  rows: ReadonlyArray<{ revenue: number; tax: number; opCost: number }>,
  options: { tax: boolean; cost: boolean; cumulative: boolean },
): number[] {
  let running = 0;
  return rows.map((row) => {
    const net = netAfterDeductions(
      row.revenue,
      options.tax ? row.tax : 0,
      options.cost ? row.opCost : 0,
    );
    running += net;
    return options.cumulative ? running : net;
  });
}
