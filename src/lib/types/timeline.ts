/**
 * Timeline Types — Martol Chat
 *
 * Unified timeline item union for rendering messages, system events,
 * pending actions, and grouped tool calls in a single sorted list.
 */

import type { DisplayMessage, SystemEvent } from '$lib/stores/messages.svelte';
import type { PendingAction } from '$lib/types/chat';

export type TimelineItem =
	| { kind: 'message'; data: DisplayMessage }
	| { kind: 'system'; data: SystemEvent }
	| { kind: 'action'; data: PendingAction }
	| { kind: 'tool_group'; data: ToolCallGroup };

export interface ToolCallGroup {
	/** Stable key — first message's localId */
	groupId: string;
	agentId: string;
	agentName: string;
	agentRole: string;
	messages: ToolCallMessage[];
	/** Timestamp of last tool call in group */
	timestamp: string;
	/** True when last message is still streaming */
	isStreaming: boolean;
}

export interface ToolCallMessage {
	localId: string;
	toolName: string;
	inputSummary: string;
	resultBody: string;
	status: 'ok' | 'error' | 'running';
	timestamp: string;
}
