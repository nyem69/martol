import { describe, it, expect } from 'vitest';
import {
	parseCommand,
	matchCommands,
	getAvailableCommands,
	COMMANDS
} from './commands';

describe('parseCommand', () => {
	it('returns null for non-slash input', () => {
		expect(parseCommand('hello world')).toBeNull();
		expect(parseCommand('')).toBeNull();
		expect(parseCommand('  just text  ')).toBeNull();
	});

	it('parses command without args', () => {
		expect(parseCommand('/clear')).toEqual({ command: 'clear', args: '' });
		expect(parseCommand('/actions')).toEqual({ command: 'actions', args: '' });
	});

	it('parses command with args', () => {
		expect(parseCommand('/whois alice')).toEqual({ command: 'whois', args: 'alice' });
		expect(parseCommand('/approve 42')).toEqual({ command: 'approve', args: '42' });
	});

	it('normalizes command to lowercase', () => {
		expect(parseCommand('/CLEAR')).toEqual({ command: 'clear', args: '' });
		expect(parseCommand('/Whois Alice')).toEqual({ command: 'whois', args: 'Alice' });
	});

	it('trims whitespace', () => {
		expect(parseCommand('  /clear  ')).toEqual({ command: 'clear', args: '' });
		expect(parseCommand('/whois   alice  ')).toEqual({ command: 'whois', args: 'alice' });
	});
});

describe('getAvailableCommands', () => {
	it('returns all commands for owner', () => {
		const cmds = getAvailableCommands('owner');
		const names = cmds.map((c) => c.name);
		expect(names).toContain('approve');
		expect(names).toContain('reject');
		expect(names).toContain('actions');
		expect(names).toContain('clear');
		expect(names).toContain('continue');
		expect(names).toContain('whois');
	});

	it('filters clear for non-owners', () => {
		const leadCmds = getAvailableCommands('lead');
		expect(leadCmds.map((c) => c.name)).not.toContain('clear');
	});

	it('returns whois, ticket and ask for members', () => {
		const memberCmds = getAvailableCommands('member');
		const names = memberCmds.map((c) => c.name);
		expect(names).toContain('whois');
		expect(names).toContain('ticket');
		expect(names).toContain('ask');
		expect(names).not.toContain('approve');
		expect(names).not.toContain('clear');
	});

	it('returns only whois and ticket for viewers', () => {
		const viewerCmds = getAvailableCommands('viewer');
		expect(viewerCmds.map((c) => c.name)).toEqual(['whois', 'ticket']);
	});
});

describe('matchCommands', () => {
	it('matches by prefix', () => {
		const matches = matchCommands('/ap', 'owner');
		expect(matches.map((c) => c.name)).toEqual(['approve']);
	});

	it('matches all with just slash', () => {
		const matches = matchCommands('/', 'owner');
		expect(matches.length).toBe(COMMANDS.length);
	});

	it('returns empty for no match', () => {
		const matches = matchCommands('/xyz', 'owner');
		expect(matches).toEqual([]);
	});

	it('respects role filtering', () => {
		const matches = matchCommands('/cl', 'lead');
		expect(matches).toEqual([]);
	});

	it('works without leading slash', () => {
		const matches = matchCommands('app', 'owner');
		expect(matches.map((c) => c.name)).toEqual(['approve']);
	});
});
