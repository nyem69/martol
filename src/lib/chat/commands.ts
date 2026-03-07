/**
 * Slash Command Registry — Martol
 *
 * Defines available slash commands with role-based access control.
 * Commands are client-side dispatched; server validates authority.
 */

export interface SlashCommand {
	name: string;
	description: string;
	/** Roles that can see and execute this command */
	roles: readonly string[];
	/** Whether the command requires an argument */
	requiresArg: boolean;
	/** Placeholder text for the argument */
	argPlaceholder?: string;
}

export const COMMANDS: SlashCommand[] = [
	{
		name: 'approve',
		description: 'chat_slash_approve',
		roles: ['owner', 'lead'],
		requiresArg: false,
		argPlaceholder: '[action_id]'
	},
	{
		name: 'reject',
		description: 'chat_slash_reject',
		roles: ['owner', 'lead'],
		requiresArg: false,
		argPlaceholder: '[action_id]'
	},
	{
		name: 'actions',
		description: 'chat_slash_actions',
		roles: ['owner', 'lead'],
		requiresArg: false
	},
	{
		name: 'clear',
		description: 'chat_slash_clear',
		roles: ['owner'],
		requiresArg: false
	},
	{
		name: 'continue',
		description: 'chat_slash_continue',
		roles: ['owner', 'lead'],
		requiresArg: false
	},
	{
		name: 'whois',
		description: 'chat_slash_whois',
		roles: ['owner', 'lead', 'member', 'viewer'],
		requiresArg: true,
		argPlaceholder: '<nick>'
	},
	{
		name: 'ticket',
		description: 'chat_slash_ticket',
		roles: ['owner', 'lead', 'member', 'viewer', 'agent'],
		requiresArg: true,
		argPlaceholder: '<title>'
	},
	{
		name: 'repair',
		description: 'chat_slash_repair',
		roles: ['owner'],
		requiresArg: false,
		argPlaceholder: '[drop]'
	}
];

/** Filter commands by user role */
export function getAvailableCommands(userRole: string): SlashCommand[] {
	return COMMANDS.filter((cmd) => cmd.roles.includes(userRole));
}

/** Match commands by prefix (for autocomplete) */
export function matchCommands(input: string, userRole: string): SlashCommand[] {
	const prefix = input.startsWith('/') ? input.slice(1).toLowerCase() : input.toLowerCase();
	return getAvailableCommands(userRole).filter((cmd) => cmd.name.startsWith(prefix));
}

export interface ParsedCommand {
	command: string;
	args: string;
}

/** Parse a slash command from input text. Returns null if not a command. */
export function parseCommand(input: string): ParsedCommand | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith('/')) return null;

	const spaceIdx = trimmed.indexOf(' ');
	if (spaceIdx === -1) {
		return { command: trimmed.slice(1).toLowerCase(), args: '' };
	}
	return {
		command: trimmed.slice(1, spaceIdx).toLowerCase(),
		args: trimmed.slice(spaceIdx + 1).trim()
	};
}
