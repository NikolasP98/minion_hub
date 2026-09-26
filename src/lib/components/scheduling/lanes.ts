/**
 * Side-by-side lanes for boxes that overlap in time — and ONLY for those.
 *
 * Lanes are counted per overlap CLUSTER (a run of boxes chained by overlap),
 * not per column: two clashing 10:00 bookings split the 10:00 area in half,
 * while the lone 14:00 booking below keeps the full width (owner bug report
 * 2026-09-26: "all other events are also split into those cols").
 *
 * Greedy first-fit inside a cluster; the result is index-aligned with `spans`.
 */
export interface LaneSpan {
  start: number;
  end: number;
}
export interface Lane {
  lane: number;
  lanes: number;
}

export function packLanes(spans: readonly LaneSpan[]): Lane[] {
  const order = spans
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Lane[] = spans.map(() => ({ lane: 0, lanes: 1 }));
  let laneEnds: number[] = [];
  let cluster: number[] = [];
  const close = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const i of cluster) out[i].lanes = lanes;
    laneEnds = [];
    cluster = [];
  };
  for (const s of order) {
    // Nothing in the cluster still runs → the cluster is over.
    if (cluster.length && laneEnds.every((end) => end <= s.start)) close();
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else laneEnds[lane] = s.end;
    out[s.i].lane = lane;
    cluster.push(s.i);
  }
  close();
  return out;
}
