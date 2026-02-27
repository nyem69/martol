/**
 * Email Service — Martol
 *
 * Sends transactional email via Resend API.
 * Dark theme email templates matching martol's industrial forge aesthetic.
 */

interface EmailOptions {
	to: string;
	subject: string;
	html: string;
}

interface EmailConfig {
	RESEND_API_KEY: string;
	EMAIL_FROM: string;
	EMAIL_NAME: string;
}

interface EmailResult {
	success: boolean;
	messageId?: string;
	error?: string;
}

/**
 * Send an email using Resend API
 */
export async function sendEmail(options: EmailOptions, config: EmailConfig): Promise<EmailResult> {
	try {
		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.RESEND_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: `${config.EMAIL_NAME} <${config.EMAIL_FROM}>`,
				to: options.to,
				subject: options.subject,
				html: options.html
			})
		});

		if (!response.ok) {
			const error = await response.text();
			console.error('[Email] Failed to send:', error);
			return { success: false, error };
		}

		const result = (await response.json()) as { id: string };
		return { success: true, messageId: result.id };
	} catch (error) {
		console.error('[Email] Error sending email:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * OTP sign-in email template
 * Includes both a clickable magic link AND a 6-digit code.
 * Dark theme matching martol's industrial forge aesthetic.
 */
export function otpEmailTemplate(
	magicLinkUrl: string,
	otpCode: string,
	appName: string
): { subject: string; html: string } {
	return {
		subject: `Sign in to ${appName} — Code: ${otpCode}`,
		html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f0f14;">
  <div style="background: linear-gradient(135deg, #2a2a32 0%, #1a1a1f 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; border-bottom: 2px solid #c49a3c;">
    <h1 style="color: #c49a3c; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 2px;">${appName}</h1>
  </div>

  <div style="background: #1a1a1f; padding: 30px; border: 1px solid #2a2a32; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin-top: 0; color: #e8e8e8; font-size: 18px;">Sign in to your workspace</h2>

    <p style="color: #a0a0a8;">Use either method below to sign in:</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${magicLinkUrl}" style="background: #c49a3c; color: #0f0f14; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; letter-spacing: 0.5px;">
        Click to Sign In
      </a>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <p style="font-size: 14px; color: #a0a0a8; margin-bottom: 10px;">Or enter this code on the login page:</p>
      <div style="background: #0f0f14; border: 2px solid #3a3a42; border-radius: 8px; padding: 20px; display: inline-block;">
        <span style="font-family: 'Courier New', monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #c49a3c;">
          ${otpCode}
        </span>
      </div>
    </div>

    <p style="font-size: 14px; color: #6a6a72; text-align: center;">
      Both the link and code expire in 15 minutes.<br>
      If you didn't request this, you can safely ignore this email.
    </p>

    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">

    <p style="font-size: 12px; color: #4a4a52; margin: 0;">
      If the button doesn't work, copy and paste this link:<br>
      <a href="${magicLinkUrl}" style="color: #c49a3c; word-break: break-all;">${magicLinkUrl}</a>
    </p>
  </div>
</body>
</html>
    `
	};
}
