#!/usr/bin/env node
/**
 * RAG Responder Load Test
 *
 * Tests concurrent RAG /ask queries across multiple rooms via the MCP API,
 * then polls for agent responses. Measures TTFB (estimated), total response
 * time, error rates, and throughput.
 *
 * Usage:
 *   MARTOL_API_KEY=mk_xxx ROOMS=room1,room2 npx tsx scripts/load-test-rag.ts
 *
 * Environment:
 *   MARTOL_URL    — base URL (default: http://localhost:5190)
 *   MARTOL_API_KEY — agent API key (required)
 *   ROOMS         — comma-separated room/org IDs (required)
 *   CONCURRENT    — max concurrent rooms per batch (default: 10)
 *   QUESTIONS     — number of questions per room (default: 5)
 *   POLL_INTERVAL — ms between poll attempts (default: 2000)
 *   TIMEOUT       — ms before giving up on a response (default: 60000)
 */

const MARTOL_URL = process.env.MARTOL_URL || 'http://localhost:5190';
const API_KEY = process.env.MARTOL_API_KEY || '';
const ROOMS = (process.env.ROOMS || '').split(',').filter(Boolean);
const CONCURRENT = parseInt(process.env.CONCURRENT || '10', 10);
const QUESTIONS = parseInt(process.env.QUESTIONS || '5', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000', 10);
const TIMEOUT = parseInt(process.env.TIMEOUT || '60000', 10);

const MCP_ENDPOINT = `${MARTOL_URL}/mcp/v1`;

const TEST_QUESTIONS = [
	'/ask What are the main topics in the uploaded documents?',
	'/ask Summarize the key findings',
	'/ask What are the conclusions?',
	'/ask List the main recommendations',
	'/ask What data sources were used?',
	'/ask Describe the methodology',
	'/ask What are the limitations mentioned?',
	'/ask What is the timeline discussed?',
	'/ask Who are the key stakeholders?',
	'/ask What are the next steps?',
];

interface Result {
	room: string;
	question: string;
	ttfb: number; // ms to first poll hit (estimated TTFB)
	total: number; // ms to completion
	bodyLen: number; // response body length in chars
	tokensPerSec: number; // rough estimate (chars / 4 / seconds)
	status: 'ok' | 'error' | 'timeout';
	error?: string;
}

function headers(roomId: string): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		'x-api-key': API_KEY,
		'x-org-id': roomId,
	};
}

async function mcpCall(roomId: string, tool: string, params: Record<string, unknown>): Promise<any> {
	const res = await fetch(MCP_ENDPOINT, {
		method: 'POST',
		headers: headers(roomId),
		body: JSON.stringify({ tool, params }),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
	}

	return res.json();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a /ask question and poll for the agent's response.
 * Returns the result with timing info.
 */
async function askAndWait(roomId: string, question: string): Promise<Result> {
	const label = question.slice(5, 50);
	const start = Date.now();
	let ttfb = 0;
	let bodyLen = 0;
	let status: Result['status'] = 'ok';
	let errorMsg: string | undefined;

	try {
		// Read current messages to get a baseline cursor
		const before = await mcpCall(roomId, 'chat_read', { limit: 1 });
		const cursorBefore = before?.data?.cursor ?? 0;

		// Send the /ask message
		const sendResult = await mcpCall(roomId, 'chat_send', { body: question });
		if (!sendResult?.ok) {
			return {
				room: roomId,
				question: label,
				ttfb: 0,
				total: Date.now() - start,
				bodyLen: 0,
				tokensPerSec: 0,
				status: 'error',
				error: sendResult?.error || 'Send failed',
			};
		}

		const sendTime = Date.now();

		// Poll for agent response
		let found = false;
		while (Date.now() - start < TIMEOUT) {
			await sleep(POLL_INTERVAL);

			const readResult = await mcpCall(roomId, 'chat_read', { limit: 20 });
			if (!readResult?.ok) continue;

			const messages: any[] = readResult.data?.messages ?? [];

			// Look for an agent response that appeared after our send
			const agentMsg = messages.find(
				(m: any) =>
					m.sender_role === 'agent' &&
					m.id > cursorBefore &&
					m.body &&
					!m.body.startsWith('/ask')
			);

			if (agentMsg) {
				if (ttfb === 0) {
					ttfb = Date.now() - sendTime;
				}
				bodyLen = agentMsg.body.length;
				found = true;
				break;
			}
		}

		if (!found) {
			status = 'timeout';
			errorMsg = `No agent response within ${TIMEOUT}ms`;
		}
	} catch (err: any) {
		status = 'error';
		errorMsg = err.message?.slice(0, 200);
	}

	const total = Date.now() - start;
	const seconds = total / 1000;
	// Rough token estimate: ~4 chars per token
	const tokensPerSec = seconds > 0 && bodyLen > 0 ? Math.round(bodyLen / 4 / seconds) : 0;

	return { room: roomId, question: label, ttfb, total, bodyLen, tokensPerSec, status, error: errorMsg };
}

/**
 * Run all questions for a single room sequentially.
 */
async function testRoom(roomId: string, questionCount: number): Promise<Result[]> {
	const results: Result[] = [];

	for (let i = 0; i < questionCount; i++) {
		const question = TEST_QUESTIONS[i % TEST_QUESTIONS.length];
		const result = await askAndWait(roomId, question);
		results.push(result);

		// Brief pause between questions to avoid hammering a single room
		if (i < questionCount - 1) {
			await sleep(1000);
		}
	}

	return results;
}

function printTable(results: Result[]): void {
	const cols = {
		room: 22,
		question: 38,
		status: 9,
		ttfb: 10,
		total: 10,
		body: 10,
		tps: 8,
	};

	const header = [
		'Room'.padEnd(cols.room),
		'Question'.padEnd(cols.question),
		'Status'.padEnd(cols.status),
		'TTFB(ms)'.padEnd(cols.ttfb),
		'Total(ms)'.padEnd(cols.total),
		'Body'.padEnd(cols.body),
		'Tok/s'.padEnd(cols.tps),
	].join(' ');

	console.log(header);
	console.log('-'.repeat(header.length));

	for (const r of results) {
		const row = [
			r.room.slice(0, cols.room - 2).padEnd(cols.room),
			r.question.slice(0, cols.question - 2).padEnd(cols.question),
			r.status.padEnd(cols.status),
			(r.ttfb > 0 ? String(r.ttfb) : '-').padEnd(cols.ttfb),
			String(r.total).padEnd(cols.total),
			String(r.bodyLen).padEnd(cols.body),
			(r.tokensPerSec > 0 ? String(r.tokensPerSec) : '-').padEnd(cols.tps),
		].join(' ');

		const suffix = r.error ? `  [${r.error}]` : '';
		console.log(row + suffix);
	}
}

function printSummary(results: Result[]): void {
	const ok = results.filter((r) => r.status === 'ok');
	const errors = results.filter((r) => r.status === 'error');
	const timeouts = results.filter((r) => r.status === 'timeout');

	const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
	const p50 = (arr: number[]) => {
		if (arr.length === 0) return 0;
		const sorted = [...arr].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length / 2)];
	};
	const p95 = (arr: number[]) => {
		if (arr.length === 0) return 0;
		const sorted = [...arr].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length * 0.95)];
	};

	const totals = ok.map((r) => r.total);
	const ttfbs = ok.filter((r) => r.ttfb > 0).map((r) => r.ttfb);
	const tps = ok.filter((r) => r.tokensPerSec > 0).map((r) => r.tokensPerSec);

	console.log(`Total requests:   ${results.length}`);
	console.log(`  OK:             ${ok.length}`);
	console.log(`  Errors:         ${errors.length}`);
	console.log(`  Timeouts:       ${timeouts.length}`);
	console.log('');
	console.log(`Response time (OK only):`);
	console.log(`  Avg:            ${avg(totals)}ms`);
	console.log(`  P50:            ${p50(totals)}ms`);
	console.log(`  P95:            ${p95(totals)}ms`);
	console.log('');
	console.log(`TTFB (estimated, OK only):`);
	console.log(`  Avg:            ${avg(ttfbs)}ms`);
	console.log(`  P50:            ${p50(ttfbs)}ms`);
	console.log('');
	console.log(`Throughput (OK only):`);
	console.log(`  Avg tok/s:      ${avg(tps)}`);
	console.log(`  Avg body len:   ${avg(ok.map((r) => r.bodyLen))} chars`);

	if (errors.length > 0) {
		console.log('');
		console.log('Errors:');
		for (const e of errors) {
			console.log(`  ${e.room}: ${e.error}`);
		}
	}
	if (timeouts.length > 0) {
		console.log('');
		console.log('Timeouts:');
		for (const t of timeouts) {
			console.log(`  ${t.room}: ${t.question}`);
		}
	}
}

async function main(): Promise<void> {
	if (!API_KEY) {
		console.error('Error: MARTOL_API_KEY is required');
		process.exit(1);
	}
	if (ROOMS.length === 0) {
		console.error('Error: ROOMS is required (comma-separated room/org IDs)');
		process.exit(1);
	}

	console.log('');
	console.log('=== RAG Responder Load Test ===');
	console.log('');
	console.log(`URL:              ${MARTOL_URL}`);
	console.log(`Rooms:            ${ROOMS.length} (${ROOMS.join(', ')})`);
	console.log(`Questions/room:   ${QUESTIONS}`);
	console.log(`Concurrent:       ${CONCURRENT}`);
	console.log(`Poll interval:    ${POLL_INTERVAL}ms`);
	console.log(`Timeout:          ${TIMEOUT}ms`);
	console.log('');

	// Verify connectivity by calling chat_who on the first room
	try {
		const whoResult = await mcpCall(ROOMS[0], 'chat_who', {});
		if (!whoResult?.ok) {
			console.error(`Connectivity check failed: ${whoResult?.error || 'Unknown error'}`);
			process.exit(1);
		}
		console.log(`Connectivity OK (room: ${whoResult.data?.room_name || ROOMS[0]})`);
	} catch (err: any) {
		console.error(`Connectivity check failed: ${err.message}`);
		process.exit(1);
	}

	console.log('Starting load test...\n');

	const allResults: Result[] = [];
	const testStart = Date.now();

	// Process rooms in batches of CONCURRENT
	for (let i = 0; i < ROOMS.length; i += CONCURRENT) {
		const batch = ROOMS.slice(i, i + CONCURRENT);
		const batchNum = Math.floor(i / CONCURRENT) + 1;
		const totalBatches = Math.ceil(ROOMS.length / CONCURRENT);

		if (totalBatches > 1) {
			console.log(`--- Batch ${batchNum}/${totalBatches} (${batch.length} rooms) ---\n`);
		}

		const batchResults = await Promise.all(batch.map((room) => testRoom(room, QUESTIONS)));
		allResults.push(...batchResults.flat());
	}

	const testDuration = Date.now() - testStart;

	// Results table
	console.log('\n=== Results ===\n');
	printTable(allResults);

	// Summary
	console.log('\n=== Summary ===\n');
	printSummary(allResults);
	console.log('');
	console.log(`Total test time:  ${(testDuration / 1000).toFixed(1)}s`);
	console.log('');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
