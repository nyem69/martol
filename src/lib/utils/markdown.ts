/**
 * Markdown Renderer — Martol
 *
 * Renders markdown to sanitized HTML using marked + DOMPurify.
 * Used for chat message rendering via {@html}.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ async: false, gfm: true, breaks: true });

export function renderMarkdown(input: string): string {
	const raw = marked.parse(input) as string;
	return DOMPurify.sanitize(raw);
}
