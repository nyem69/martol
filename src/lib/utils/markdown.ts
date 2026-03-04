/**
 * Markdown Renderer — Martol
 *
 * Renders markdown to sanitized HTML using marked + DOMPurify.
 * Used for chat message rendering via {@html}.
 * Only runs client-side (chat route has ssr = false).
 */

import { marked, type Tokens } from 'marked';
import DOMPurify, { type Config } from 'dompurify';

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const renderer = new marked.Renderer();
const originalImage = renderer.image.bind(renderer);
renderer.image = function (token: Tokens.Image) {
	if (token.href.startsWith('r2:')) {
		const r2Key = token.href.slice(3);
		const src = `/api/upload?key=${encodeURIComponent(r2Key)}`;
		const alt = escapeAttr(token.text || '');
		const title = escapeAttr(token.title || '');
		return `<img src="${src}" alt="${alt}" title="${title}" class="chat-img-thumb" loading="lazy" />`;
	}
	return originalImage(token);
};

marked.setOptions({ async: false, gfm: true, breaks: true, renderer });

// Restrict to tags needed for chat markdown — no <style>, <form>, <svg>, etc.
const PURIFY_CONFIG: Config = {
	ALLOWED_TAGS: [
		'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
		'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'img'
	],
	ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'loading'],
	ALLOW_DATA_ATTR: false
};

// Scoped DOMPurify instance — prevents hook from affecting other DOMPurify consumers
const purify = DOMPurify();

purify.addHook('afterSanitizeAttributes', (node) => {
	// Force external links to open in new tab with noopener
	if (node.tagName === 'A') {
		node.setAttribute('rel', 'noopener noreferrer');
		node.setAttribute('target', '_blank');
		const href = node.getAttribute('href') || '';
		if (!/^(https?:|mailto:|#)/.test(href)) {
			node.removeAttribute('href');
		}
	}
	// Re-apply thumbnail class on R2 images (class attr is not in allowlist to prevent UI spoofing)
	if (node.tagName === 'IMG') {
		const src = node.getAttribute('src') || '';
		if (src.startsWith('/api/upload?key=')) {
			node.setAttribute('class', 'chat-img-thumb');
		}
	}
});

export function renderMarkdown(input: string): string {
	const raw = marked.parse(input) as string;
	return purify.sanitize(raw, PURIFY_CONFIG) as string;
}
