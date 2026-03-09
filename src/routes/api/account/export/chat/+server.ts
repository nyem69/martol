/**
 * POST /api/account/export/chat — Chat export preview & generation
 *
 * Step 1 (preview): POST { roomId } → returns room info, message count, date range, attachment stats
 * Step 2 (generate): POST { roomId, includePhotos, includeFiles, confirm: true }
 *   → generates markdown export, zips (with attachments if requested), uploads to R2, emails download link
 *
 * Auth: session-based.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, organization, user } from '$lib/server/db/auth-schema';
import { messages, attachments } from '$lib/server/db/schema';
import { eq, and, isNull, sql, asc, inArray } from 'drizzle-orm';
import { sendEmail, exportReadyEmailTemplate } from '$lib/server/email';

const R2_IMAGE_RE = /!\[[^\]]*\]\(r2:([^)]+)\)/g;
const DOWNLOAD_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB cap for attachments in export
const EXPORT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between exports per room

/** HMAC-SHA256 sign a payload string */
async function signToken(payload: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Verify HMAC-SHA256 signature */
async function verifyToken(payload: string, signature: string, secret: string): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
}

export { verifyToken };

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

	// Build markdown content
	const lines: string[] = [];
	lines.push(`# ${room.name}`);
	lines.push(`Exported: ${new Date().toISOString().slice(0, 10)}`);
	lines.push(`Messages: ${allMessages.length} | Date range: ${stats.earliest ? new Date(stats.earliest).toISOString().slice(0, 10) : 'N/A'} — ${stats.latest ? new Date(stats.latest).toISOString().slice(0, 10) : 'N/A'}`);
	lines.push('---');
	lines.push('');

	// Track r2 keys we need to download (keyed by r2Key → messageId for unique paths)
	const r2KeysToDownload = new Map<string, number>();

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

		// Rewrite r2: references to local paths in export (scoped by message ID to avoid collisions)
		if (includePhotos) {
			msgBody = msgBody.replace(/!\[[^\]]*\]\(r2:([^)]+)\)/g, (_match: string, key: string) => {
				const filename = key.split('/').pop() || key;
				return `![${filename}](attachments/${msg.id}-${filename})`;
			});
		} else {
			// Strip image markers, keep text description
			msgBody = msgBody.replace(R2_IMAGE_RE, '[attachment]');
		}

		if (msg.type === 'system' || msg.type === 'join') {
			lines.push(`${ts} [${msg.type}] ${msgBody}`);
		} else {
			lines.push(`${ts} ${sender}: ${msgBody}`);
		}
	}

	const mdContent = lines.join('\n');

	// Build zip using minimal zip structure
	// For simplicity on CF Workers (no Node.js zlib), we store uncompressed in a zip container
	const zipFiles: { name: string; data: Uint8Array }[] = [];

	const roomSlug = room.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
	zipFiles.push({
		name: `${roomSlug}.md`,
		data: new TextEncoder().encode(mdContent)
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
	const tokenSecret = platform?.env?.RESEND_API_KEY || 'export-fallback-secret';
	const payload = JSON.stringify({ key: exportKey, exp: expiresAt.getTime(), uid: userId });
	const payloadB64 = btoa(payload);
	const sig = await signToken(payload, tokenSecret);
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
