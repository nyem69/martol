/**
 * Tool Call Parser — Martol
 *
 * Detects and parses tool-call messages for grouping in the chat timeline.
 *
 * Phase 1: Heuristic — body prefix `[tool:<name>]`
 * Phase 2: Wire field — `subtype === 'tool_call'` (authoritative)
 */

import type { DisplayMessage } from '$lib/stores/messages.svelte';
import type { ToolCallMessage } from '$lib/types/timeline';

/** Pattern: `[tool:tool_name] optional input | result body` */
const TOOL_PREFIX_RE = /^\[tool:([a-z_][a-z0-9_]*)\]\s*/i;

/** Secondary separator between input summary and result body */
const INPUT_SEPARATOR = ' | ';

/**
 * Detect whether a message is a tool-call message.
 *
 * Checks `subtype` wire field first (authoritative, Phase 2),
 * then falls back to body prefix heuristic (Phase 1).
 */
export function isToolCallMessage(msg: DisplayMessage): boolean {
	if (msg.subtype === 'tool_call') return true;
	return msg.senderRole === 'agent' && TOOL_PREFIX_RE.test(msg.body);
}

/**
 * Parse a tool-call message body into structured fields.
 *
 * Expected format:
 *   `[tool:doc_search] query: "auth flow" | Found 3 chunks...`
 *
 * If no `|` separator, the entire body after the prefix is the result.
 */
export function parseToolCallBody(msg: DisplayMessage): ToolCallMessage {
	const match = msg.body.match(TOOL_PREFIX_RE);
	const toolName = match ? match[1] : 'unknown';
	const rest = match ? msg.body.slice(match[0].length) : msg.body;

	let inputSummary = '';
	let resultBody = rest;

	const sepIdx = rest.indexOf(INPUT_SEPARATOR);
	if (sepIdx !== -1) {
		inputSummary = rest.slice(0, sepIdx).slice(0, 120);
		resultBody = rest.slice(sepIdx + INPUT_SEPARATOR.length);
	}

	const status: ToolCallMessage['status'] = msg.streaming
		? 'running'
		: msg.failed
			? 'error'
			: 'ok';

	return {
		localId: msg.localId,
		toolName,
		inputSummary,
		resultBody,
		status,
		timestamp: msg.timestamp
	};
}
