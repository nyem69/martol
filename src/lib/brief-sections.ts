/**
 * Structured brief sections — parse, serialize, and render.
 *
 * The `content` column in `project_brief` stays as a single text field.
 * We store structured sections as JSON and fall back gracefully for
 * plain-text legacy briefs (put entire text into `notes`).
 */

export interface BriefSections {
	goal: string;
	stack: string;
	conventions: string;
	phase: string;
	notes: string;
}

export const SECTION_META = [
	{ key: 'goal' as const, labelKey: 'chat_brief_section_goal', placeholderKey: 'chat_brief_placeholder_goal', rows: 3 },
	{ key: 'stack' as const, labelKey: 'chat_brief_section_stack', placeholderKey: 'chat_brief_placeholder_stack', rows: 3 },
	{ key: 'conventions' as const, labelKey: 'chat_brief_section_conventions', placeholderKey: 'chat_brief_placeholder_conventions', rows: 3 },
	{ key: 'phase' as const, labelKey: 'chat_brief_section_phase', placeholderKey: 'chat_brief_placeholder_phase', rows: 2 },
	{ key: 'notes' as const, labelKey: 'chat_brief_section_notes', placeholderKey: 'chat_brief_placeholder_notes', rows: 4 },
] as const;

const EMPTY_SECTIONS: BriefSections = { goal: '', stack: '', conventions: '', phase: '', notes: '' };

export function parseBriefContent(content: string | null): BriefSections {
	if (!content) return { ...EMPTY_SECTIONS };

	try {
		const parsed = JSON.parse(content);
		if (parsed && typeof parsed === 'object' && 'goal' in parsed) {
			return {
				goal: typeof parsed.goal === 'string' ? parsed.goal : '',
				stack: typeof parsed.stack === 'string' ? parsed.stack : '',
				conventions: typeof parsed.conventions === 'string' ? parsed.conventions : '',
				phase: typeof parsed.phase === 'string' ? parsed.phase : '',
				notes: typeof parsed.notes === 'string' ? parsed.notes : '',
			};
		}
	} catch {
		// Not JSON — treat as legacy plain text
	}

	// Legacy plain text → put in notes
	return { ...EMPTY_SECTIONS, notes: content };
}

export function serializeBriefSections(sections: BriefSections): string {
	return JSON.stringify(sections);
}

export function renderBriefForPrompt(sections: BriefSections): string {
	const parts: string[] = [];
	if (sections.goal) parts.push(`## Goal\n${sections.goal}`);
	if (sections.stack) parts.push(`## Stack\n${sections.stack}`);
	if (sections.conventions) parts.push(`## Conventions\n${sections.conventions}`);
	if (sections.phase) parts.push(`## Current Phase\n${sections.phase}`);
	if (sections.notes) parts.push(`## Notes\n${sections.notes}`);
	return parts.join('\n\n');
}

export function totalLength(sections: BriefSections): number {
	return sections.goal.length + sections.stack.length + sections.conventions.length + sections.phase.length + sections.notes.length;
}
