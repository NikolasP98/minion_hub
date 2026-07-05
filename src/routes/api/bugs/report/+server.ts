import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { createBug } from '$server/services/bug.service';
import { createGitHubIssue, isGitHubConfigured } from '$server/services/github-issues.service';
import { getStorage, isStorageConfigured } from '$server/storage/blob';
import { newId } from '$server/db/utils';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { servers } from '@minion-stack/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401, 'No tenant context');

  let body: {
    screenshot?: string;
    pastedImages?: string[];
    consoleLogs?: Array<{ level: string; message: string; timestamp: number; stack?: string }>;
    severity?: string;
    comment?: string;
    stateSnapshot?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const bugId = newId();
  const severity = (body.severity ?? 'medium') as 'critical' | 'high' | 'medium' | 'low';
  let screenshotUrl: string | undefined;
  let githubIssueUrl: string | undefined;

  // 1. Upload screenshot to storage if configured and provided
  if (body.screenshot && isStorageConfigured()) {
    try {
      // Strip data URL prefix: "data:image/png;base64,..."
      const base64Data = body.screenshot.replace(/^data:image\/\w+;base64,/, '');
      const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      const b2Key = `${ctx.tenantId}/bug-reports/${bugId}/screenshot.png`;

      const storage = getStorage();
      await storage.put(b2Key, binaryData, 'image/png');
      screenshotUrl = await storage.getSignedUrl(b2Key, 7 * 24 * 3600); // 7-day expiry
    } catch (err) {
      console.error('[POST /api/bugs/report] B2 upload failed:', err);
      // Continue without screenshot URL
    }
  }

  // 2. Create GitHub issue if configured (uploads screenshot directly to repo)
  if (isGitHubConfigured()) {
    try {
      // Strip data URL prefix for GitHub upload
      const screenshotBase64 = body.screenshot
        ? body.screenshot.replace(/^data:image\/\w+;base64,/, '')
        : undefined;

      const issue = await createGitHubIssue({
        comment: body.comment ?? '',
        severity,
        screenshotBase64,
        screenshotUrl,
        pastedImages: body.pastedImages,
        consoleLogs: body.consoleLogs,
        stateSnapshot: body.stateSnapshot,
        bugId,
      });
      githubIssueUrl = issue.html_url;
    } catch (err) {
      console.error('[POST /api/bugs/report] GitHub issue creation failed:', err);
      // Continue without GitHub issue
    }
  }

  // 3. Save to bugs table
  try {
    const metadata = JSON.stringify({
      githubIssueUrl: githubIssueUrl ?? null,
      screenshotUrl: screenshotUrl ?? null,
      stateSnapshot: body.stateSnapshot ?? null,
      consoleLogCount: body.consoleLogs?.length ?? 0,
    });

    // Resolve a valid serverId for FK constraint
    const activeHostId = (body.stateSnapshot?.activeHostId as string) ?? null;
    let serverId = activeHostId;
    if (!serverId) {
      const row = await ctx.db
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.tenantId, ctx.tenantId))
        .limit(1);
      serverId = row[0]?.id ?? null;
    }

    if (serverId) {
      await createBug(ctx, {
        serverId,
        message: body.comment || `Bug report (${severity})`,
        severity,
        metadata,
      });
    }
  } catch (err) {
    console.error('[POST /api/bugs/report] DB save failed:', err);
    throw error(500, 'Failed to save bug report');
  }

  return json({
    ok: true,
    bugId,
    githubIssueUrl: githubIssueUrl ?? null,
  });
};
