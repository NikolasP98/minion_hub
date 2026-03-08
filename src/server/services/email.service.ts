import { env } from '$env/dynamic/private';
import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend | null {
	const key = env.RESEND_API_KEY;
	if (!key) return null;
	if (!_resend) _resend = new Resend(key);
	return _resend;
}

interface InvitationEmailParams {
	to: string;
	inviterName: string;
	organizationName: string;
	role: string;
	inviteUrl: string;
}

export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
	const resend = getResend();
	if (!resend) {
		console.warn(
			`[email] RESEND_API_KEY not set — skipping invitation email to ${params.to}. ` +
			`Share this link manually: ${params.inviteUrl}`,
		);
		return;
	}

	const from = env.RESEND_FROM ?? 'Minion Hub <noreply@minionhub.admin-console.dev>';
	const { to, inviterName, organizationName, role, inviteUrl } = params;

	const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#13131a;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden">
        <tr><td style="padding:32px 32px 24px;text-align:center">
          <div style="display:inline-block;margin-bottom:16px">
            <span style="background:#e91e8c;color:#000;font-weight:900;font-size:13px;letter-spacing:0.5px;padding:3px 8px;border-radius:4px 0 0 4px;text-transform:uppercase">MINION</span>
            <span style="color:#fff;font-weight:700;font-size:13px;padding:3px 6px">hub</span>
          </div>
          <h1 style="color:#e4e4e7;font-size:20px;font-weight:600;margin:0 0 8px">You're invited!</h1>
          <p style="color:#71717a;font-size:14px;margin:0 0 24px;line-height:1.5">
            <strong style="color:#a1a1aa">${inviterName}</strong> invited you to join
            <strong style="color:#a1a1aa">${organizationName}</strong> as <strong style="color:#a1a1aa">${role}</strong>.
          </p>
          <a href="${inviteUrl}" style="display:inline-block;background:#e91e8c;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 32px;border-radius:8px;letter-spacing:0.3px">
            Accept Invitation
          </a>
          <p style="color:#52525b;font-size:12px;margin:24px 0 0;line-height:1.5">
            Or copy this link:<br>
            <a href="${inviteUrl}" style="color:#e91e8c;word-break:break-all">${inviteUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #1e1e2e;text-align:center">
          <p style="color:#3f3f46;font-size:11px;margin:0">Sent by Minion Hub</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

	try {
		await resend.emails.send({
			from,
			to,
			subject: `${inviterName} invited you to join ${organizationName} on Minion Hub`,
			html,
			headers: {
				'List-Unsubscribe': `<mailto:${from.match(/<(.+)>/)?.[1] ?? 'noreply@minionhub.admin-console.dev'}?subject=unsubscribe>`,
			},
		});
	} catch (err) {
		console.error('[email] Failed to send invitation email:', err);
	}
}
