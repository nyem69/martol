/**
 * Markdown Renderer — Martol
 *
 * Renders markdown to sanitized HTML using marked + DOMPurify.
 * Used for chat message rendering via {@html}.
 * Only runs client-side (chat route has ssr = false).
 */

import { marked } from 'marked';
import DOMPurify, { type Config } from 'dompurify';

marked.setOptions({ async: false, gfm: true, breaks: true });

// Restrict to tags needed for chat markdown — no <style>, <form>, <svg>, etc.
const PURIFY_CONFIG: Config = {
	ALLOWED_TAGS: [
		'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
		'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span'
	],
	ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
	ALLOW_DATA_ATTR: false
};

// Scoped DOMPurify instance — prevents hook from affecting other DOMPurify consumers
const purify = DOMPurify();

// Force external links to open in new tab with noopener
purify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A') {
		node.setAttribute('rel', 'noopener noreferrer');
		node.setAttribute('target', '_blank');
		const href = node.getAttribute('href') || '';
		if (!/^(https?:|mailto:|#)/.test(href)) {
			node.removeAttribute('href');
		}
	}
});

export function renderMarkdown(input: string): string {
	const raw = marked.parse(input) as string;
	return purify.sanitize(raw, PURIFY_CONFIG) as string;
}
