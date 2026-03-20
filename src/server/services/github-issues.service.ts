import { env } from '$env/dynamic/private';

const GITHUB_API = 'https://api.github.com';

interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

interface GitHubIssueResult {
  id: number;
  number: number;
  html_url: string;
}

async function fetchGitHub(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<unknown> {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'minion-hub',
    Authorization: `Bearer ${token}`,
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${GITHUB_API}/${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${path} — ${text}`);
  }

  return res.json();
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: ':red_circle:',
  high: ':orange_circle:',
  medium: ':yellow_circle:',
  low: ':green_circle:',
};

export function isGitHubConfigured(): boolean {
  return !!(env.GITHUB_TOKEN && env.GITHUB_BUG_REPO);
}

/**
 * Upload a file to the repo via GitHub Contents API.
 * Returns the permanent raw.githubusercontent.com URL.
 */
async function uploadScreenshotToRepo(
  repo: string,
  base64Content: string,
  bugId: string,
): Promise<string> {
  const path = `.bug-reports/${bugId}.png`;
  const result = (await fetchGitHub(`repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `bug: screenshot for ${bugId}`,
      content: base64Content,
    }),
  })) as { content?: { download_url?: string } };

  return (
    result.content?.download_url ??
    `https://raw.githubusercontent.com/${repo}/main/${path}`
  );
}

export async function createGitHubIssue(input: {
  comment: string;
  severity: string;
  screenshotBase64?: string;
  screenshotUrl?: string;
  consoleLogs?: Array<{ level: string; message: string; timestamp: number }>;
  stateSnapshot?: Record<string, unknown>;
  bugId?: string;
}): Promise<GitHubIssueResult> {
  const repo = env.GITHUB_BUG_REPO;
  if (!repo) throw new Error('GITHUB_BUG_REPO not configured');

  const emoji = SEVERITY_EMOJI[input.severity] ?? ':yellow_circle:';

  // Upload screenshot to repo if base64 data provided
  let screenshotUrl = input.screenshotUrl;
  if (input.screenshotBase64 && input.bugId) {
    try {
      screenshotUrl = await uploadScreenshotToRepo(
        repo,
        input.screenshotBase64,
        input.bugId,
      );
    } catch (err) {
      console.error('[GitHub] Screenshot upload failed:', err);
    }
  }

  // Build markdown body
  const sections: string[] = [];

  sections.push(`## Bug Report\n**Severity:** ${emoji} ${input.severity}`);

  if (input.comment) {
    sections.push(`### Description\n${input.comment}`);
  }

  if (screenshotUrl) {
    sections.push(`### Screenshot\n![Screenshot](${screenshotUrl})`);
  }

  if (input.consoleLogs?.length) {
    const rows = input.consoleLogs
      .slice(-50)
      .map((e) => {
        const time = new Date(e.timestamp).toISOString().slice(11, 23);
        const msg = e.message.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200);
        return `| ${time} | ${e.level} | ${msg} |`;
      })
      .join('\n');

    sections.push(
      `<details><summary>Console Logs (${input.consoleLogs.length} entries)</summary>\n\n| Time | Level | Message |\n|------|-------|---------|` +
        '\n' +
        rows +
        '\n\n</details>',
    );
  }

  if (input.stateSnapshot) {
    const snap = JSON.stringify(input.stateSnapshot, null, 2);
    sections.push(
      `<details><summary>State Snapshot</summary>\n\n\`\`\`json\n${snap}\n\`\`\`\n\n</details>`,
    );
  }

  sections.push(`---\n*Reported from Minion Hub at ${new Date().toISOString()}*`);

  const title = input.comment
    ? `[Bug] ${input.comment.slice(0, 80)}${input.comment.length > 80 ? '...' : ''}`
    : `[Bug] ${input.severity} severity report`;

  const body: CreateIssueInput = {
    title,
    body: sections.join('\n\n'),
    labels: ['bug', input.severity],
  };

  const result = await fetchGitHub(`repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return result as GitHubIssueResult;
}
