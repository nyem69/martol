/**
 * Image Scanning via Workers AI — Martol
 *
 * Scans uploaded images for unsafe content using Cloudflare Workers AI.
 * Fail-closed: any AI error blocks the upload.
 */

const MAX_SCAN_SIZE = 4 * 1024 * 1024; // 4 MB

export interface ScanResult {
	safe: boolean;
	reason?: string;
}

/**
 * Scan an image buffer for unsafe content.
 * Only scans image/* types; non-images are skipped (returned as safe).
 */
export async function scanImage(
	ai: Ai,
	buffer: ArrayBuffer,
	contentType: string
): Promise<ScanResult> {
	// Only scan images
	if (!contentType.startsWith('image/')) {
		return { safe: true };
	}

	// Reject oversized images before sending to AI
	if (buffer.byteLength > MAX_SCAN_SIZE) {
		return { safe: false, reason: 'image_too_large_for_scan' };
	}

	try {
		const response = await ai.run('@cf/microsoft/resnet-50', {
			image: [...new Uint8Array(buffer)]
		}) as { label: string; score: number }[];

		// resnet-50 is a classification model — check for NSFW/unsafe labels
		// If the model flags any unsafe category with high confidence, block it
		const UNSAFE_LABELS = new Set([
			'bikini', 'brassiere', 'maillot', 'swimming_trunks',
			'military_uniform', 'rifle', 'assault_rifle', 'revolver',
			'holster', 'syringe'
		]);

		for (const result of response) {
			if (UNSAFE_LABELS.has(result.label) && result.score > 0.85) {
				return { safe: false, reason: `flagged:${result.label}` };
			}
		}

		return { safe: true };
	} catch (error) {
		// Fail-closed: AI errors block the upload
		console.error('[ImageScan] AI scan failed:', error);
		return { safe: false, reason: 'scan_error' };
	}
}
