/**
 * Hub-owned channel-claim lifecycle (OTP + Telegram deep-link).
 *
 * The hub owns this end-to-end so claiming a channel identity works regardless
 * of which gateway/extension is installed. State lives in the Supabase
 * `pending_channel_claims` table (durable across Vercel serverless invocations);
 * the gateway is only used for the final delivery hop (sending the OTP / arming
 * the deep link), which the route layer handles — this module is pure PG state.
 *
 * Security:
 *   - codes are stored HMAC-hashed, compared in constant time
 *   - 30s resend cooldown + per-user hourly send cap (anti-spam: this can message
 *     arbitrary numbers via the gateway's WhatsApp account)
 *   - 5 verify attempts then the claim is burned
 *   - requestId is always re-scoped to the calling user
 */
import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$server/supabase';

const OTP_TTL_MS = 10 * 60 * 1000;
const DEEPLINK_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const HOURLY_SEND_CAP = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABLE = 'pending_channel_claims';

type Admin = ReturnType<typeof supabaseAdmin>;

type ClaimRow = {
  id: string;
  user_id: string;
  channel: string;
  method: 'otp' | 'deeplink';
  channel_user_id: string | null;
  display_name: string | null;
  code_hash: string | null;
  start_token: string | null;
  attempts: number;
  max_attempts: number;
  last_sent_at: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

function claimSecret(): string {
  return env.ENCRYPTION_KEY || env.BETTER_AUTH_SECRET || 'dev-channel-claim-secret';
}

/** HMAC a code so the DB never holds the plaintext OTP. */
function hashCode(code: string): string {
  return createHmac('sha256', claimSecret()).update(code).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** Normalise a channel target so uniqueness is consistent across entries. */
export function normalizeChannelUserId(channel: string, raw: string): string {
  const t = raw.trim();
  if (channel === 'whatsapp') return t.replace(/[^\d]/g, ''); // E.164 digits, no '+'
  if (channel === 'telegram') return t.replace(/^@/, '').trim();
  return t;
}

/** Map a caller id (supabase uuid) → profiles.id. Post-GoTrue these are equal. */
async function resolveProfileId(admin: Admin, userId: string): Promise<string | null> {
  if (!UUID_RE.test(userId)) return null;
  const { data } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function recentSendCount(admin: Admin, profileId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profileId)
    .gte('last_sent_at', since);
  return count ?? 0;
}

export type RequestOtpResult =
  | { ok: true; requestId: string; code: string; channelUserId: string; cooldownMs: number }
  | { ok: false; reason: 'cooldown' | 'rate' | 'profile'; retryAfterMs?: number };

/**
 * Create or refresh an OTP claim. Returns the plaintext `code` to the caller
 * (the route) so it can hand it to the gateway for delivery; the code is only
 * ever stored hashed.
 */
export async function requestOtpClaim(input: {
  supabaseId: string;
  channel: string;
  channelUserId: string;
  displayName?: string | null;
}): Promise<RequestOtpResult> {
  const admin = supabaseAdmin();
  const profileId = await resolveProfileId(admin, input.supabaseId);
  if (!profileId) return { ok: false, reason: 'profile' };

  const channelUserId = normalizeChannelUserId(input.channel, input.channelUserId);
  const now = Date.now();

  // Existing live claim for this exact target → enforce the resend cooldown.
  const { data: existing } = await admin
    .from(TABLE)
    .select('*')
    .eq('user_id', profileId)
    .eq('channel', input.channel)
    .eq('channel_user_id', channelUserId)
    .is('consumed_at', null)
    .maybeSingle();
  const row = existing as ClaimRow | null;

  if (row?.last_sent_at) {
    const elapsed = now - Date.parse(row.last_sent_at);
    if (elapsed < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfterMs: RESEND_COOLDOWN_MS - elapsed };
    }
  }

  if ((await recentSendCount(admin, profileId)) >= HOURLY_SEND_CAP) {
    return { ok: false, reason: 'rate', retryAfterMs: 60 * 60 * 1000 };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hashCode(code);
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
  const lastSentAt = new Date(now).toISOString();

  if (row) {
    await admin
      .from(TABLE)
      .update({
        method: 'otp',
        code_hash: codeHash,
        display_name: input.displayName ?? row.display_name,
        attempts: 0,
        last_sent_at: lastSentAt,
        expires_at: expiresAt,
      })
      .eq('id', row.id);
    return { ok: true, requestId: row.id, code, channelUserId, cooldownMs: RESEND_COOLDOWN_MS };
  }

  const { data: inserted, error } = await admin
    .from(TABLE)
    .insert({
      user_id: profileId,
      channel: input.channel,
      method: 'otp',
      channel_user_id: channelUserId,
      display_name: input.displayName ?? null,
      code_hash: codeHash,
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
      last_sent_at: lastSentAt,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !inserted) throw new Error(`claim insert failed: ${error?.message ?? 'unknown'}`);
  return { ok: true, requestId: inserted.id as string, code, channelUserId, cooldownMs: RESEND_COOLDOWN_MS };
}

export type VerifyResult =
  | { ok: true; channel: string; channelUserId: string; displayName: string | null }
  | { ok: false; reason: 'unknown' | 'expired' | 'mismatch' | 'attempts' | 'consumed' };

/** Verify an OTP and burn the claim on success. */
export async function verifyOtpClaim(input: {
  supabaseId: string;
  requestId: string;
  code: string;
}): Promise<VerifyResult> {
  const admin = supabaseAdmin();
  const profileId = await resolveProfileId(admin, input.supabaseId);
  if (!profileId) return { ok: false, reason: 'unknown' };

  const { data } = await admin
    .from(TABLE)
    .select('*')
    .eq('id', input.requestId)
    .eq('user_id', profileId)
    .maybeSingle();
  const row = data as ClaimRow | null;
  if (!row || row.method !== 'otp' || !row.code_hash) return { ok: false, reason: 'unknown' };
  if (row.consumed_at) return { ok: false, reason: 'consumed' };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= row.max_attempts) return { ok: false, reason: 'attempts' };

  if (!safeEqualHex(hashCode(input.code), row.code_hash)) {
    const attempts = row.attempts + 1;
    await admin
      .from(TABLE)
      .update({ attempts, ...(attempts >= row.max_attempts ? { consumed_at: new Date().toISOString() } : {}) })
      .eq('id', row.id);
    return { ok: false, reason: attempts >= row.max_attempts ? 'attempts' : 'mismatch' };
  }

  await admin.from(TABLE).update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
  return {
    ok: true,
    channel: row.channel,
    channelUserId: row.channel_user_id ?? '',
    displayName: row.display_name,
  };
}

/** Begin a Telegram deep-link claim. Returns an opaque token for `?start=<token>`. */
export async function startTelegramDeepLink(input: {
  supabaseId: string;
  displayName?: string | null;
}): Promise<{ ok: true; requestId: string; token: string } | { ok: false; reason: 'profile' | 'rate' }> {
  const admin = supabaseAdmin();
  const profileId = await resolveProfileId(admin, input.supabaseId);
  if (!profileId) return { ok: false, reason: 'profile' };
  if ((await recentSendCount(admin, profileId)) >= HOURLY_SEND_CAP) return { ok: false, reason: 'rate' };

  const token = randomBytes(18).toString('base64url');
  const now = Date.now();
  const { data, error } = await admin
    .from(TABLE)
    .insert({
      user_id: profileId,
      channel: 'telegram',
      method: 'deeplink',
      channel_user_id: null,
      display_name: input.displayName ?? null,
      start_token: token,
      last_sent_at: new Date(now).toISOString(),
      expires_at: new Date(now + DEEPLINK_TTL_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`deeplink insert failed: ${error?.message ?? 'unknown'}`);
  return { ok: true, requestId: data.id as string, token };
}

export type ClaimStatus =
  | { state: 'pending'; method: 'otp' | 'deeplink'; channel: string; token: string | null }
  | { state: 'done'; channel: string; channelUserId: string; displayName: string | null }
  | { state: 'expired' }
  | { state: 'unknown' };

/** Read a claim's status (for the deep-link poller). Scoped to the caller. */
export async function getClaim(input: {
  supabaseId: string;
  requestId: string;
}): Promise<ClaimStatus & { row?: ClaimRow }> {
  const admin = supabaseAdmin();
  const profileId = await resolveProfileId(admin, input.supabaseId);
  if (!profileId) return { state: 'unknown' };
  const { data } = await admin
    .from(TABLE)
    .select('*')
    .eq('id', input.requestId)
    .eq('user_id', profileId)
    .maybeSingle();
  const row = data as ClaimRow | null;
  if (!row) return { state: 'unknown' };
  if (row.consumed_at && row.channel_user_id) {
    return {
      state: 'done',
      channel: row.channel,
      channelUserId: row.channel_user_id,
      displayName: row.display_name,
      row,
    };
  }
  if (Date.parse(row.expires_at) < Date.now()) return { state: 'expired', row };
  return { state: 'pending', method: row.method, channel: row.channel, token: row.start_token, row };
}

/** Bind a resolved Telegram id to a deep-link claim and burn it. */
export async function resolveTelegramDeepLink(input: {
  requestId: string;
  telegramUserId: string;
  telegramName?: string | null;
}): Promise<{ ok: true; userId: string; channelUserId: string; displayName: string | null } | { ok: false }> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from(TABLE)
    .select('*')
    .eq('id', input.requestId)
    .maybeSingle();
  const row = data as ClaimRow | null;
  if (!row || row.method !== 'deeplink') return { ok: false };
  if (row.consumed_at) {
    return row.channel_user_id
      ? { ok: true, userId: row.user_id, channelUserId: row.channel_user_id, displayName: row.display_name }
      : { ok: false };
  }
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false };

  const channelUserId = normalizeChannelUserId('telegram', input.telegramUserId);
  const displayName = input.telegramName ?? row.display_name;
  await admin
    .from(TABLE)
    .update({ channel_user_id: channelUserId, display_name: displayName, consumed_at: new Date().toISOString() })
    .eq('id', row.id);
  return { ok: true, userId: row.user_id, channelUserId, displayName };
}

export type AttachResult = { ok: true; id: string } | { ok: false; reason: 'taken' | 'profile' };

/**
 * Write a verified channel identity into the canonical Supabase `user_identities`
 * vault (kind='channel'). The `(provider, external_id)` unique index guarantees a
 * target can belong to only one hub user; a conflict with another user → 'taken'.
 * Idempotent when the same user re-claims the same target.
 */
export async function attachChannelIdentitySupabase(
  supabaseId: string,
  input: { channel: string; channelUserId: string; displayName?: string | null },
): Promise<AttachResult> {
  const admin = supabaseAdmin();
  const profileId = await resolveProfileId(admin, supabaseId);
  if (!profileId) return { ok: false, reason: 'profile' };

  const channelUserId = normalizeChannelUserId(input.channel, input.channelUserId);
  const nowMs = Date.now();

  // Pre-check the unique (provider, external_id) key so we can distinguish
  // "already yours" (idempotent) from "owned by someone else" (taken).
  const { data: clash } = await admin
    .from('user_identities')
    .select('id, user_id')
    .eq('provider', input.channel)
    .eq('external_id', channelUserId)
    .maybeSingle();
  if (clash) {
    if ((clash.user_id as string) !== profileId) return { ok: false, reason: 'taken' };
    await admin
      .from('user_identities')
      .update({
        display_name: input.displayName ?? null,
        verified_at: nowMs,
        updated_at: new Date(nowMs).toISOString(),
      })
      .eq('id', clash.id as string);
    return { ok: true, id: clash.id as string };
  }

  const { data, error } = await admin
    .from('user_identities')
    .insert({
      user_id: profileId,
      provider: input.channel,
      kind: 'channel',
      external_id: channelUserId,
      display_name: input.displayName ?? null,
      verified_at: nowMs,
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { ok: false, reason: 'taken' };
    throw new Error(`identity insert failed: ${error.message}`);
  }
  return { ok: true, id: (data?.id as string) ?? '' };
}
