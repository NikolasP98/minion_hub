/**
 * TTL arm/disarm/remaining for the QA stack (spec §5). Primary lane is a
 * transient `systemd-run --user` timer (survives the shell that armed it);
 * on hosts without a user systemd instance, falls back to a detached
 * `sleep <n>; down.ts`, tracked by a PID + deadline file under `.qa/`.
 *
 * `armTtl`/`disarmTtl`/`remainingTtl` are imported by up.ts, down.ts,
 * status.ts and extend.ts. No CLI is exposed here — pure helpers
 * (parseTtl/clampTtl/formatDuration/parseSystemdLeft) are unit tested in
 * ttl.test.ts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const QA_DIR = join(ROOT, '.qa');
const PID_FILE = join(QA_DIR, 'ttl.pid');
const DEADLINE_FILE = join(QA_DIR, 'ttl.deadline');
const UNIT = 'hub-qa-ttl';

export const DEFAULT_TTL_SECONDS = 2 * 3600;
export const MAX_TTL_SECONDS = 8 * 3600;
export const MIN_TTL_SECONDS = 60;

/** Pure: clamps to [MIN_TTL_SECONDS, MAX_TTL_SECONDS] (spec §5: default 2h, max 8h). */
export function clampTtl(seconds: number): number {
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.round(seconds)));
}

/** Pure: parses `--ttl` values like "90m" or "2h"; undefined -> the default. */
export function parseTtl(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TTL_SECONDS;
  const match = /^(\d+)(s|m|h)$/.exec(raw.trim());
  if (!match) {
    throw new Error(`Invalid --ttl "${raw}" — expected a number plus s/m/h, e.g. "90m" or "2h"`);
  }
  const amount = Number(match[1]);
  const unitSeconds = match[2] === 's' ? 1 : match[2] === 'm' ? 60 : 3600;
  return clampTtl(amount * unitSeconds);
}

/** Pure: seconds -> "1h 30m" / "45s" for printing. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && sec) parts.push(`${sec}s`);
  return parts.length ? parts.join(' ') : '0s';
}

/**
 * Pure: sums a systemd `list-timers` LEFT column like "1min 59s" or
 * "2h 33min" into seconds. Display-only precision (ms/us dropped).
 */
export function parseSystemdLeft(text: string): number {
  const re = /(\d+)\s*(h|min|s)\b/g;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (m[2] === 'h') total += n * 3600;
    else if (m[2] === 'min') total += n * 60;
    else total += n;
  }
  return total;
}

function haveSystemdUser(): boolean {
  const probe = spawnSync('systemctl', ['--user', 'show', '-p', 'Version'], { stdio: 'ignore' });
  return probe.status === 0;
}

/** Stops both lanes defensively (either may be inactive) and clears tracking files. Idempotent. */
export function disarmTtl(): void {
  spawnSync('systemctl', ['--user', 'stop', `${UNIT}.timer`, `${UNIT}.service`], {
    stdio: 'ignore',
  });
  spawnSync('systemctl', ['--user', 'reset-failed', `${UNIT}.service`], { stdio: 'ignore' });
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
    rmSync(PID_FILE, { force: true });
  }
  rmSync(DEADLINE_FILE, { force: true });
}

export interface ArmResult {
  mode: 'systemd' | 'fallback';
  deadline: Date;
}

/** Arms (or re-arms) the TTL to fire `bun scripts/qa/down.ts` in `seconds`. */
export function armTtl(seconds: number): ArmResult {
  disarmTtl();
  mkdirSync(QA_DIR, { recursive: true });
  const deadline = new Date(Date.now() + seconds * 1000);
  const downScript = join(ROOT, 'scripts', 'qa', 'down.ts');

  if (haveSystemdUser()) {
    const result = spawnSync(
      'systemd-run',
      [
        '--user',
        `--on-active=${seconds}s`,
        `--unit=${UNIT}`,
        '--description=hub QA stack TTL teardown',
        process.execPath,
        downScript,
      ],
      { stdio: 'inherit' },
    );
    if (result.status === 0) return { mode: 'systemd', deadline };
    console.warn('qa:ttl — systemd-run failed, falling back to a detached sleep');
  }

  const child = spawn(
    'setsid',
    ['sh', '-c', `sleep ${seconds}; "${process.execPath}" "${downScript}"`],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();
  writeFileSync(PID_FILE, String(child.pid ?? ''));
  writeFileSync(DEADLINE_FILE, deadline.toISOString());
  return { mode: 'fallback', deadline };
}

export interface RemainingResult {
  armed: boolean;
  seconds?: number;
  mode?: 'systemd' | 'fallback';
}

/** Reads remaining TTL time without arming/disarming anything. */
export function remainingTtl(): RemainingResult {
  if (existsSync(PID_FILE) && existsSync(DEADLINE_FILE)) {
    const deadlineMs = new Date(readFileSync(DEADLINE_FILE, 'utf8').trim()).getTime();
    const seconds = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
    return { armed: seconds > 0, seconds, mode: 'fallback' };
  }
  // Prefer JSON (systemd >= 257): {"next": <epoch-usec>, ...} — remaining is
  // just `next/1e6 - now`, no column parsing needed.
  const jsonResult = spawnSync(
    'systemctl',
    ['--user', 'list-timers', '--all', `${UNIT}.timer`, '-o', 'json'],
    { encoding: 'utf8' },
  );
  if (jsonResult.status === 0 && jsonResult.stdout) {
    const seconds = parseListTimersJson(jsonResult.stdout, `${UNIT}.timer`);
    if (seconds !== null)
      return { armed: seconds > 0, seconds: Math.max(0, seconds), mode: 'systemd' };
  }

  // Fallback for older systemd without `-o json` on list-timers: parse the
  // text table. NEXT is a 4-token date ("Wed 2026-09-16 02:49:13 -05");
  // ponytail: known-fragile on unusual locales/timer states, acceptable
  // because the JSON path above is what actually runs on any modern host.
  const textResult = spawnSync('systemctl', ['--user', 'list-timers', '--all', `${UNIT}.timer`], {
    encoding: 'utf8',
  });
  if (textResult.status !== 0 || !textResult.stdout) return { armed: false };
  const match = new RegExp(`^(.+?)\\s+-\\s+-\\s+${UNIT}\\.timer\\b`, 'm').exec(textResult.stdout);
  if (!match) return { armed: false };
  const tokens = match[1].trim().split(/\s+/);
  const leftText = tokens.slice(4).join(' '); // tokens[0..3] = weekday, date, time, tz offset
  if (!leftText) return { armed: false };
  return { armed: true, seconds: parseSystemdLeft(leftText), mode: 'systemd' };
}

/** Pure: extracts remaining seconds for `unit` from `list-timers -o json` output, or null if absent/unparseable. */
export function parseListTimersJson(stdout: string, unit: string): number | null {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r): r is { unit: string; next: number } => r?.unit === unit);
  if (!row || typeof row.next !== 'number') return null;
  return Math.round(row.next / 1_000_000 - Date.now() / 1000);
}
