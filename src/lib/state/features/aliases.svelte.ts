const TTL_MS = 5 * 60 * 1000;

let aliases = $state(new Map<string, string>());
let fetchedAt = $state<number | null>(null);
let inflight: Promise<Map<string, string>> | null = null;

export function getAliases() {
  return aliases;
}

export async function ensureAliases(): Promise<Map<string, string>> {
  if (fetchedAt && Date.now() - fetchedAt < TTL_MS) return aliases;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/users/aliases');
      if (!res.ok) return aliases;
      const data = (await res.json()) as { aliases: Record<string, string> };
      // server returns { userId: alias }; renderer needs { alias: userId } — invert.
      const inverted = new Map<string, string>();
      for (const [userId, alias] of Object.entries(data.aliases)) inverted.set(alias, userId);
      aliases = inverted;
      fetchedAt = Date.now();
      return aliases;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateAliases() {
  fetchedAt = null;
}
