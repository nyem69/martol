/**
 * POST /api/account/export/chat — Chat export preview & generation
 *
 * Step 1 (preview): POST { roomId } → returns room info, message count, date range, attachment stats
 * Step 2 (generate): POST { roomId, includePhotos, includeFiles, confirm: true }
 *   → generates HTML export, zips (with attachments if requested), uploads to R2, emails download link
 *
 * Auth: session-based.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, organization, user } from '$lib/server/db/auth-schema';
import { messages, attachments } from '$lib/server/db/schema';
import { eq, and, isNull, sql, asc, inArray } from 'drizzle-orm';
import { sendEmail, exportReadyEmailTemplate } from '$lib/server/email';
import { signExportToken } from '$lib/server/export-token';
import { stripSecrets } from '$lib/server/sanitize-secrets';

const R2_IMAGE_RE = /!\[[^\]]*\]\(r2:([^)]+)\)/g;
const DOWNLOAD_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB cap for attachments in export
const EXPORT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between exports per room

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const db = locals.db;
	const userId = locals.user.id;
	const body = (await request.json()) as {
		roomId?: string;
		confirm?: boolean;
		includePhotos?: boolean;
		includeFiles?: boolean;
	};

	// If no roomId, return user's rooms list
	if (!body.roomId) {
		const rooms = await db
			.select({
				id: organization.id,
				name: organization.name
			})
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(eq(member.userId, userId))
			.orderBy(organization.name);

		return json({ ok: true, rooms });
	}

	const roomId = body.roomId;

	// Verify membership
	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, roomId), eq(member.userId, userId)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this room');

	// Get room name
	const [room] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, roomId))
		.limit(1);

	if (!room) error(404, 'Room not found');

	// Get message stats (excluding deleted)
	const [stats] = await db
		.select({
			count: sql<number>`count(*)::int`,
			earliest: sql<string>`min(${messages.createdAt})`,
			latest: sql<string>`max(${messages.createdAt})`
		})
		.from(messages)
		.where(and(eq(messages.orgId, roomId), isNull(messages.deletedAt)));

	// Get attachment stats — only for non-deleted messages
	const [attachmentStats] = await db
		.select({
			photoCount: sql<number>`count(*) filter (where ${attachments.contentType} like 'image/%')::int`,
			fileCount: sql<number>`count(*) filter (where ${attachments.contentType} not like 'image/%')::int`,
			photoBytes: sql<number>`coalesce(sum(${attachments.sizeBytes}) filter (where ${attachments.contentType} like 'image/%'), 0)::bigint`,
			fileBytes: sql<number>`coalesce(sum(${attachments.sizeBytes}) filter (where ${attachments.contentType} not like 'image/%'), 0)::bigint`
		})
		.from(attachments)
		.innerJoin(messages, eq(messages.id, attachments.messageId))
		.where(and(eq(attachments.orgId, roomId), isNull(messages.deletedAt)));

	// If not confirming, return preview stats
	if (!body.confirm) {
		return json({
			ok: true,
			preview: {
				roomName: room.name,
				messageCount: stats.count || 0,
				dateRange: {
					from: stats.earliest,
					to: stats.latest
				},
				photos: {
					count: attachmentStats.photoCount || 0,
					bytes: Number(attachmentStats.photoBytes) || 0
				},
				files: {
					count: attachmentStats.fileCount || 0,
					bytes: Number(attachmentStats.fileBytes) || 0
				}
			}
		});
	}

	// ── Generate export ──
	const r2 = platform?.env?.STORAGE;
	if (!r2) error(503, 'Storage unavailable');

	if (!locals.user.email) error(400, 'No email address on account');

	// Rate limit: check for recent export of this room by this user
	const exportPrefix = `exports/${userId}/`;
	const recentExports = await r2.list({ prefix: exportPrefix, limit: 20 });
	const now = Date.now();
	for (const obj of recentExports.objects) {
		const meta = obj.customMetadata;
		if (meta?.roomId === roomId) {
			const exportTime = obj.uploaded.getTime();
			if (now - exportTime < EXPORT_COOLDOWN_MS) {
				const minutesLeft = Math.ceil((EXPORT_COOLDOWN_MS - (now - exportTime)) / 60000);
				return json(
					{ ok: false, error: { message: `Please wait ${minutesLeft} minute(s) before exporting this room again.` } },
					{ status: 429 }
				);
			}
		}
	}

	const includePhotos = !!body.includePhotos;
	const includeFiles = !!body.includeFiles;

	// Fetch all non-deleted messages with sender info
	const allMessages = await db
		.select({
			id: messages.id,
			body: messages.body,
			type: messages.type,
			createdAt: messages.createdAt,
			senderName: user.name,
			senderUsername: user.username,
			senderDisplayName: user.displayName
		})
		.from(messages)
		.innerJoin(user, eq(user.id, messages.senderId))
		.where(and(eq(messages.orgId, roomId), isNull(messages.deletedAt)))
		.orderBy(asc(messages.createdAt));

	// Build message rows for HTML export
	const r2KeysToDownload = new Map<string, number>();
	const messageRows: Array<{ ts: string; sender: string; body: string; type: string }> = [];

	for (const msg of allMessages) {
		const ts = msg.createdAt
			? new Date(msg.createdAt).toISOString().replace('T', ' ').slice(0, 19)
			: '????-??-?? ??:??:??';
		const sender = msg.senderDisplayName || msg.senderUsername || msg.senderName || 'unknown';
		let msgBody = msg.body;

		// Collect r2 keys from message body
		if (includePhotos || includeFiles) {
			for (const match of msgBody.matchAll(R2_IMAGE_RE)) {
				r2KeysToDownload.set(match[1], msg.id);
			}
		}

		// Rewrite r2: references to local attachment paths in export
		if (includePhotos) {
			msgBody = msgBody.replace(/!\[[^\]]*\]\(r2:([^)]+)\)/g, (_match: string, key: string) => {
				const filename = key.split('/').pop() || key;
				return `[IMG:attachments/${msg.id}-${filename}]`;
			});
		} else {
			msgBody = msgBody.replace(R2_IMAGE_RE, '[attachment]');
		}

		// Strip secrets after attachment rewriting, before HTML encoding
		msgBody = stripSecrets(msgBody);

		messageRows.push({ ts, sender, body: msgBody, type: msg.type });
	}

	const htmlContent = buildHtmlExport(
		room.name,
		messageRows,
		stats.earliest ?? null,
		stats.latest ?? null
	);

	// Build zip using minimal zip structure
	const zipFiles: { name: string; data: Uint8Array }[] = [];

	const roomSlug = room.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
	zipFiles.push({
		name: `${roomSlug}.html`,
		data: new TextEncoder().encode(htmlContent)
	});

	// Download attachments from R2 if requested
	if ((includePhotos || includeFiles) && r2KeysToDownload.size > 0) {
		const keyList = Array.from(r2KeysToDownload.keys());
		const attachmentRecords = await db
			.select({
				r2Key: attachments.r2Key,
				contentType: attachments.contentType,
				filename: attachments.filename
			})
			.from(attachments)
			.where(and(eq(attachments.orgId, roomId), inArray(attachments.r2Key, keyList)));

		const r2KeyMeta = new Map<string, { r2Key: string; contentType: string; filename: string }>();
		for (const a of attachmentRecords) r2KeyMeta.set(a.r2Key, a);

		let totalAttachmentBytes = 0;

		for (const key of keyList) {
			const meta = r2KeyMeta.get(key);
			if (!meta) continue;

			const isImage = meta.contentType.startsWith('image/');
			if (isImage && !includePhotos) continue;
			if (!isImage && !includeFiles) continue;

			try {
				const obj = await r2.get(key);
				if (!obj) continue;

				// Check size cap before reading full body
				const objSize = obj.size;
				if (totalAttachmentBytes + objSize > MAX_ATTACHMENT_BYTES) {
					break; // Stop adding attachments at cap
				}

				const buf = await obj.arrayBuffer();
				totalAttachmentBytes += buf.byteLength;

				const filename = key.split('/').pop() || key;
				const msgId = r2KeysToDownload.get(key);
				zipFiles.push({
					name: `attachments/${msgId}-${filename}`,
					data: new Uint8Array(buf)
				});
			} catch {
				// Skip failed downloads
			}
		}
	}

	// Create zip
	const zipData = buildZip(zipFiles);

	// Upload to R2 with exports/ prefix
	const exportKey = `exports/${userId}/${Date.now()}-${roomSlug}.zip`;
	const expiresAt = new Date(Date.now() + DOWNLOAD_EXPIRY_MS);

	await r2.put(exportKey, zipData, {
		httpMetadata: {
			contentType: 'application/zip',
			contentDisposition: `attachment; filename="${roomSlug}-export.zip"`
		},
		customMetadata: {
			userId,
			roomId,
			expiresAt: expiresAt.toISOString()
		}
	});

	// Build download URL with HMAC-signed token
	const tokenSecret = platform?.env?.EXPORT_TOKEN_SECRET || platform?.env?.RESEND_API_KEY;
	if (!tokenSecret) error(500, 'Export signing secret not configured');
	const payload = JSON.stringify({ key: exportKey, exp: expiresAt.getTime(), uid: userId });
	const payloadB64 = btoa(payload);
	const sig = await signExportToken(payload, tokenSecret);
	const downloadToken = `${payloadB64}.${sig}`;

	const baseUrl = platform?.env?.APP_BASE_URL || 'https://martol.plitix.com';
	const downloadUrl = `${baseUrl}/api/account/export/chat/download?token=${encodeURIComponent(downloadToken)}`;

	// Send email
	const emailConfig = {
		RESEND_API_KEY: platform?.env?.RESEND_API_KEY || '',
		EMAIL_FROM: platform?.env?.EMAIL_FROM || 'noreply@martol.app',
		EMAIL_NAME: platform?.env?.EMAIL_NAME || 'Martol'
	};

	const emailTemplate = exportReadyEmailTemplate(room.name, downloadUrl, '72 hours');

	const emailResult = await sendEmail(
		{ to: locals.user.email, subject: emailTemplate.subject, html: emailTemplate.html },
		emailConfig
	);

	if (!emailResult.success) {
		console.error('[Export] Email send failed:', emailResult.error);
	}

	return json({
		ok: true,
		message: 'Export started. You will receive an email with the download link shortly.',
		expiresAt: expiresAt.toISOString()
	});
};

/** HTML-escape user content to prevent XSS */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Build a self-contained HTML export of chat messages.
 * Dark theme, inline CSS, day dividers, [SECRET] badge styling.
 */
function buildHtmlExport(
	roomName: string,
	rows: Array<{ ts: string; sender: string; body: string; type: string }>,
	earliest: string | null,
	latest: string | null
): string {
	const exportDate = new Date().toISOString().slice(0, 10);
	const dateRange = earliest && latest
		? `${escapeHtml(earliest.slice(0, 10))} — ${escapeHtml(latest.slice(0, 10))}`
		: 'No messages';

	let messagesHtml = '';
	let lastDate = '';

	for (const row of rows) {
		const date = row.ts.slice(0, 10);
		if (date !== lastDate) {
			lastDate = date;
			messagesHtml += `<div class="day">${escapeHtml(date)}</div>\n`;
		}

		const isSystem = row.type === 'system' || row.type === 'join' || row.type === 'leave';
		const bodyHtml = escapeHtml(row.body)
			.replace(/\[IMG:([^\]]+)\]/g, (_m: string, src: string) => `<img src="${escapeHtml(src)}" style="max-width:480px;max-height:360px;border-radius:4px;margin:4px 0;display:block">`)
			.replace(/\[SECRET\]/g, '<span class="secret">[SECRET]</span>')
			.replace(/\[attachment\]/g, '<span class="att">[attachment]</span>')
			.replace(/\n/g, '<br>');

		if (isSystem) {
			messagesHtml += `<div class="msg sys"><span class="ts">${escapeHtml(row.ts.slice(11))}</span> ${bodyHtml}</div>\n`;
		} else {
			messagesHtml += `<div class="msg"><span class="ts">${escapeHtml(row.ts.slice(11))}</span> <span class="sender">${escapeHtml(row.sender)}</span> ${bodyHtml}</div>\n`;
		}
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(roomName)} — Chat Export</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1a1a;color:#d4d4d4;font:14px/1.6 'SF Mono',Menlo,Consolas,monospace;padding:0}
header{position:sticky;top:0;background:#111;border-bottom:1px solid #333;padding:16px 24px;z-index:10}
header h1{font-size:18px;color:#e5e5e5;font-weight:600}
header .meta{font-size:12px;color:#888;margin-top:4px}
.content{max-width:960px;margin:0 auto;padding:16px 24px 80px}
.day{text-align:center;color:#666;font-size:12px;margin:24px 0 8px;padding:4px 0;border-bottom:1px solid #2a2a2a}
.msg{padding:3px 0;word-wrap:break-word}
.msg.sys{color:#666;font-style:italic}
.ts{color:#555;font-size:12px;margin-right:4px}
.sender{color:#6bb3e0;font-weight:600;margin-right:4px}
.sender::after{content:':'}
.secret{background:#7f1d1d;color:#fca5a5;padding:1px 5px;border-radius:3px;font-size:12px;font-weight:600}
.att{color:#888;font-style:italic}
footer{text-align:center;color:#555;font-size:11px;padding:24px;border-top:1px solid #2a2a2a;margin-top:40px}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(roomName)}</h1>
<div class="meta">${rows.length.toLocaleString()} messages · ${dateRange} · Exported ${exportDate}</div>
</header>
<div class="content">
${messagesHtml}
</div>
<footer>Exported from Martol · ${exportDate}</footer>
</body>
</html>`;
}

/**
 * Minimal ZIP builder for Cloudflare Workers (no zlib dependency).
 * Stores files uncompressed — good enough for text + images that are already compressed.
 */
function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
	const entries: { offset: number; name: Uint8Array; data: Uint8Array; crc: number }[] = [];
	const parts: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const nameBytes = new TextEncoder().encode(file.name);
		const crc = crc32(file.data);

		// Local file header (30 bytes + name + data)
		const header = new Uint8Array(30);
		const view = new DataView(header.buffer);
		view.setUint32(0, 0x04034b50, true); // signature
		view.setUint16(4, 20, true); // version needed
		view.setUint16(6, 0, true); // flags
		view.setUint16(8, 0, true); // compression: store
		view.setUint16(10, 0, true); // mod time
		view.setUint16(12, 0, true); // mod date
		view.setUint32(14, crc, true); // crc-32
		view.setUint32(18, file.data.length, true); // compressed size
		view.setUint32(22, file.data.length, true); // uncompressed size
		view.setUint16(26, nameBytes.length, true); // name length
		view.setUint16(28, 0, true); // extra field length

		entries.push({ offset, name: nameBytes, data: file.data, crc });
		parts.push(header, nameBytes, file.data);
		offset += 30 + nameBytes.length + file.data.length;
	}

	// Central directory
	const cdStart = offset;
	for (const entry of entries) {
		const cdEntry = new Uint8Array(46);
		const cdView = new DataView(cdEntry.buffer);
		cdView.setUint32(0, 0x02014b50, true); // signature
		cdView.setUint16(4, 20, true); // version made by
		cdView.setUint16(6, 20, true); // version needed
		cdView.setUint16(8, 0, true); // flags
		cdView.setUint16(10, 0, true); // compression
		cdView.setUint16(12, 0, true); // mod time
		cdView.setUint16(14, 0, true); // mod date
		cdView.setUint32(16, entry.crc, true); // crc-32
		cdView.setUint32(20, entry.data.length, true); // compressed size
		cdView.setUint32(24, entry.data.length, true); // uncompressed size
		cdView.setUint16(28, entry.name.length, true); // name length
		cdView.setUint16(30, 0, true); // extra field length
		cdView.setUint16(32, 0, true); // comment length
		cdView.setUint16(34, 0, true); // disk number start
		cdView.setUint16(36, 0, true); // internal attributes
		cdView.setUint32(38, 0, true); // external attributes
		cdView.setUint32(42, entry.offset, true); // offset of local header

		parts.push(cdEntry, entry.name);
		offset += 46 + entry.name.length;
	}

	// End of central directory
	const cdSize = offset - cdStart;
	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	eocdView.setUint32(0, 0x06054b50, true); // signature
	eocdView.setUint16(4, 0, true); // disk number
	eocdView.setUint16(6, 0, true); // disk with CD
	eocdView.setUint16(8, entries.length, true); // entries on this disk
	eocdView.setUint16(10, entries.length, true); // total entries
	eocdView.setUint32(12, cdSize, true); // CD size
	eocdView.setUint32(16, cdStart, true); // CD offset
	eocdView.setUint16(20, 0, true); // comment length
	parts.push(eocd);

	// Concatenate all parts
	const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
	const result = new Uint8Array(totalLength);
	let pos = 0;
	for (const part of parts) {
		result.set(part, pos);
		pos += part.length;
	}
	return result;
}

/** CRC-32 (IEEE 802.3) */
function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}
