/**
 * k6 Load Test — WebSocket Rooms
 *
 * Tests WebSocket connections and message delivery under load.
 * Requires API keys for agent auth.
 *
 * Run: API_KEY=... k6 run tests/load/websocket-rooms.js
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'wss://martol.plitix.com';
const API_KEY = __ENV.API_KEY || '';
const ROOM_COUNT = 10;

const messagesReceived = new Counter('ws_messages_received');
const messageLatency = new Trend('ws_message_latency');

export const options = {
	stages: [
		{ duration: '30s', target: 50 },  // Ramp up to 50 connections
		{ duration: '2m', target: 100 },  // Sustained 100 connections
		{ duration: '30s', target: 0 }    // Ramp down
	],
	thresholds: {
		ws_message_latency: ['p(95)<200'],  // 95th percentile < 200ms
		ws_messages_received: ['count>100']
	}
};

export default function () {
	if (!API_KEY) {
		console.warn('API_KEY not set — skipping WebSocket test');
		sleep(1);
		return;
	}

	const roomIdx = __VU % ROOM_COUNT;
	const roomId = __ENV[`ROOM_${roomIdx}`] || `loadtest-room-${roomIdx}`;
	const url = `${BASE_URL}/api/rooms/${roomId}/ws`;

	const res = ws.connect(url, { headers: { 'x-api-key': API_KEY } }, function (socket) {
		socket.on('open', () => {
			// Send a test message
			const sendTime = Date.now();
			socket.send(JSON.stringify({
				type: 'chat',
				body: `Load test message from VU ${__VU} at ${sendTime}`,
				clientId: `lt-${__VU}-${sendTime}`
			}));
		});

		socket.on('message', (data) => {
			messagesReceived.add(1);
			try {
				const msg = JSON.parse(data);
				if (msg.clientId && msg.clientId.startsWith(`lt-${__VU}-`)) {
					const sendTime = parseInt(msg.clientId.split('-')[2]);
					messageLatency.add(Date.now() - sendTime);
				}
			} catch {
				// Non-JSON message (typing indicators, etc.)
			}
		});

		socket.on('error', (e) => {
			console.error(`WS error: ${e.error()}`);
		});

		// Keep connection alive for 10 seconds
		sleep(10);
		socket.close();
	});

	check(res, {
		'ws connected': (r) => r && r.status === 101
	});

	sleep(1);
}
