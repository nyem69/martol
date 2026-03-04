/**
 * Markdown Renderer — Martol
 *
 * Renders markdown to sanitized HTML using marked + DOMPurify.
 * Used for chat message rendering via {@html}.
 * Only runs client-side (chat route has ssr = false).
 */

import { marked } from 'marked';
import DOMPurify, { type Config } from 'dompurify';

// Custom renderer: rewrite r2: image URLs to /api/upload?key=...
const renderer: import('marked').RendererObject = {
	image({ href, title, text }) {
		if (href.startsWith('r2:')) {
			const key = href.slice(3);
			const titleAttr = title ? ` title="${title}"` : '';
			return `<img src="/api/upload?key=${encodeURIComponent(key)}" alt="${text || ''}"${titleAttr} loading="lazy" class="r2-image cursor-pointer">`;
		}
		// External images — DOMPurify will validate src
		const titleAttr = title ? ` title="${title}"` : '';
		return `<img src="${href}" alt="${text || ''}"${titleAttr} loading="lazy">`;
	}
};

marked.use({ renderer });
marked.setOptions({ async: false, gfm: true, breaks: true });

// Restrict to tags needed for chat markdown — no <style>, <form>, <svg>, etc.
const PURIFY_CONFIG: Config = {
	ALLOWED_TAGS: [
		'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
		'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'img'
	],
	ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'loading', 'class'],
	ALLOW_DATA_ATTR: false
};

// Scoped DOMPurify instance — prevents hook from affecting other DOMPurify consumers
const purify = DOMPurify();

// Validate attributes after sanitization
purify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A') {
		node.setAttribute('rel', 'noopener noreferrer');
		node.setAttribute('target', '_blank');
		const href = node.getAttribute('href') || '';
		if (!/^(https?:|mailto:|#)/.test(href)) {
			node.removeAttribute('href');
		}
	}
	// IMG src: only allow /api/upload?key= and https:// — block javascript:, data:, etc.
	if (node.tagName === 'IMG') {
		const src = node.getAttribute('src') || '';
		if (!src.startsWith('/api/upload?key=') && !src.startsWith('https://')) {
			node.removeAttribute('src');
		}
	}
});

export function renderMarkdown(input: string): string {
	const raw = marked.parse(input) as string;
	return purify.sanitize(raw, PURIFY_CONFIG) as string;
}
