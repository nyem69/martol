/**
 * k6 Load Test — MCP Endpoint
 *
 * Tests the MCP v1 endpoint under load with API key auth.
 * Simulates agent traffic patterns.
 *
 * Run: API_KEY=... k6 run tests/load/mcp-endpoint.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://martol.plitix.com';
const API_KEY = __ENV.API_KEY || '';

export const options = {
	stages: [
		{ duration: '30s', target: 30 },  // Ramp up
		{ duration: '1m', target: 60 },   // Sustained load (matches 60 req/min limit)
		{ duration: '30s', target: 0 }    // Ramp down
	],
	thresholds: {
		http_req_duration: ['p(95)<500'],
		http_req_failed: ['rate<0.10']
	}
};

export default function () {
	if (!API_KEY) {
		console.warn('API_KEY not set — skipping MCP test');
		sleep(1);
		return;
	}

	// MCP tools/list request
	const toolsList = http.post(
		`${BASE_URL}/mcp/v1`,
		JSON.stringify({
			jsonrpc: '2.0',
			id: `lt-${__VU}-${Date.now()}`,
			method: 'tools/list',
			params: {}
		}),
		{
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': API_KEY
			}
		}
	);

	check(toolsList, {
		'mcp responds': (r) => r.status === 200 || r.status === 429,
		'mcp not 500': (r) => r.status !== 500
	});

	// MCP room_read tool call
	const roomRead = http.post(
		`${BASE_URL}/mcp/v1`,
		JSON.stringify({
			jsonrpc: '2.0',
			id: `lt-${__VU}-${Date.now()}`,
			method: 'tools/call',
			params: {
				name: 'room_read',
				arguments: { limit: 10 }
			}
		}),
		{
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': API_KEY
			}
		}
	);

	check(roomRead, {
		'room_read responds': (r) => r.status === 200 || r.status === 429,
		'room_read not 500': (r) => r.status !== 500
	});

	sleep(1);
}
