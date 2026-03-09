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
 * Room invitation email template
 * Sent when a user is invited to join a room.
 */
export function invitationEmailTemplate(
	inviterName: string,
	orgName: string,
	acceptUrl: string
): { subject: string; html: string } {
	return {
		subject: `You're invited to ${orgName} on Martol`,
		html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f0f14;">
  <div style="background: linear-gradient(135deg, #2a2a32 0%, #1a1a1f 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; border-bottom: 2px solid #c49a3c;">
    <h1 style="color: #c49a3c; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 2px;">MARTOL</h1>
  </div>

  <div style="background: #1a1a1f; padding: 30px; border: 1px solid #2a2a32; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin-top: 0; color: #e8e8e8; font-size: 18px;">You've been invited</h2>

    <p style="color: #a0a0a8;"><strong style="color: #e8e8e8;">${inviterName}</strong> invited you to join <strong style="color: #c49a3c;">${orgName}</strong> on Martol.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${acceptUrl}" style="background: #c49a3c; color: #0f0f14; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; letter-spacing: 0.5px;">
        Join Room
      </a>
    </div>

    <p style="font-size: 14px; color: #6a6a72; text-align: center;">
      Sign in with your email to accept the invitation.
    </p>

    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">

    <p style="font-size: 12px; color: #4a4a52; margin: 0;">
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
    `
	};
}

/**
 * Email change confirmation template
 * Sent to the NEW email address to confirm the change.
 */
export function emailChangeConfirmTemplate(
	confirmUrl: string
): { subject: string; html: string } {
	return {
		subject: 'Confirm your new email address — Martol',
		html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f0f14;">
  <div style="background: linear-gradient(135deg, #2a2a32 0%, #1a1a1f 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; border-bottom: 2px solid #c49a3c;">
    <h1 style="color: #c49a3c; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 2px;">MARTOL</h1>
  </div>

  <div style="background: #1a1a1f; padding: 30px; border: 1px solid #2a2a32; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin-top: 0; color: #e8e8e8; font-size: 18px;">Confirm your new email</h2>

    <p style="color: #a0a0a8;">Click the button below to confirm this email address as your new Martol login.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${confirmUrl}" style="background: #c49a3c; color: #0f0f14; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; letter-spacing: 0.5px;">
        Confirm Email Change
      </a>
    </div>

    <p style="font-size: 14px; color: #6a6a72; text-align: center;">
      This link expires in 72 hours. If you didn't request this change, ignore this email.
    </p>

    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">

    <p style="font-size: 12px; color: #4a4a52; margin: 0;">
      If the button doesn't work, copy and paste this link:<br>
      <a href="${confirmUrl}" style="color: #c49a3c; word-break: break-all;">${confirmUrl}</a>
    </p>
  </div>
</body>
</html>
    `
	};
}

/**
 * Email change revert template
 * Sent to the OLD email address with an undo link (72h window).
 */
export function emailChangeRevertTemplate(
	revertUrl: string
): { subject: string; html: string } {
	return {
		subject: 'Your Martol email is being changed — undo within 72 hours',
		html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f0f14;">
  <div style="background: linear-gradient(135deg, #2a2a32 0%, #1a1a1f 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; border-bottom: 2px solid #c49a3c;">
    <h1 style="color: #c49a3c; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 2px;">MARTOL</h1>
  </div>

  <div style="background: #1a1a1f; padding: 30px; border: 1px solid #2a2a32; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin-top: 0; color: #e8e8e8; font-size: 18px;">Email change requested</h2>

    <p style="color: #a0a0a8;">Someone requested to change the email address on your Martol account. If this was you, no action is needed.</p>

    <p style="color: #a0a0a8;">If you did <strong style="color: #e8e8e8;">not</strong> request this change, click the button below to cancel it:</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${revertUrl}" style="background: #dc2626; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; letter-spacing: 0.5px;">
        Undo Email Change
      </a>
    </div>

    <p style="font-size: 14px; color: #6a6a72; text-align: center;">
      This undo link expires in 72 hours.
    </p>

    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">

    <p style="font-size: 12px; color: #4a4a52; margin: 0;">
      If the button doesn't work, copy and paste this link:<br>
      <a href="${revertUrl}" style="color: #c49a3c; word-break: break-all;">${revertUrl}</a>
    </p>
  </div>
</body>
</html>
    `
	};
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
		subject: `Sign in to ${appName}`,
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

/**
 * Export ready email template
 * Sent when a chat export zip is ready for download.
 */
export function exportReadyEmailTemplate(
	roomName: string,
	downloadUrl: string,
	expiresIn: string
): { subject: string; html: string } {
	return {
		subject: `Your chat export is ready — ${roomName}`,
		html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f0f14;">
  <div style="background: linear-gradient(135deg, #2a2a32 0%, #1a1a1f 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center; border-bottom: 2px solid #c49a3c;">
    <h1 style="color: #c49a3c; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 2px;">MARTOL</h1>
  </div>

  <div style="background: #1a1a1f; padding: 30px; border: 1px solid #2a2a32; border-top: none; border-radius: 0 0 12px 12px;">
    <h2 style="margin-top: 0; color: #e8e8e8; font-size: 18px;">Your export is ready</h2>

    <p style="color: #a0a0a8;">Your chat export for <strong style="color: #c49a3c;">${roomName}</strong> has been generated and is ready for download.</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${downloadUrl}" style="background: #c49a3c; color: #0f0f14; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; letter-spacing: 0.5px;">
        Download Export
      </a>
    </div>

    <p style="font-size: 14px; color: #6a6a72; text-align: center;">
      This link expires in ${expiresIn}. Download your export before it's removed.
    </p>

    <hr style="border: none; border-top: 1px solid #2a2a32; margin: 20px 0;">

    <p style="font-size: 12px; color: #4a4a52; margin: 0;">
      If the button doesn't work, copy and paste this link:<br>
      <a href="${downloadUrl}" style="color: #c49a3c; word-break: break-all;">${downloadUrl}</a>
    </p>
  </div>
</body>
</html>
    `
	};
}
