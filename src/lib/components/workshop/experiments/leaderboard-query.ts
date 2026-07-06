export type LeaderboardRow = {
  modelId: string;
  rankings: number;
  wins: number;
  winRate: number;
  avgRank: number | null;
  runs: number;
  avgLatencyMs: number | null;
  totalCostUsd: number;
};

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const res = await fetch('/api/workshop/leaderboard');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { rows: LeaderboardRow[] }).rows;
}

/** Shared query options — same key across LeaderboardStrip + LeaderboardTab dedupes the request. */
export function leaderboardQueryOptions() {
  return {
    queryKey: ['workshop', 'leaderboard'] as const,
    queryFn: fetchLeaderboard,
  };
}
