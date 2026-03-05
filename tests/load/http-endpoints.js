/**
 * k6 Load Test — HTTP Endpoints
 *
 * Tests REST API endpoints under load.
 * Run: k6 run tests/load/http-endpoints.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://martol.plitix.com';

export const options = {
	stages: [
		{ duration: '30s', target: 20 },  // Ramp up
		{ duration: '1m', target: 50 },   // Sustained load
		{ duration: '30s', target: 0 }    // Ramp down
	],
	thresholds: {
		http_req_duration: ['p(95)<500'],  // 95th percentile < 500ms
		http_req_failed: ['rate<0.05']     // Error rate < 5%
	}
};

export default function () {
	// Health check — landing page
	const landing = http.get(`${BASE_URL}/`);
	check(landing, {
		'landing 200': (r) => r.status === 200
	});

	// Auth endpoint — should return 401 for unauthenticated
	const sessions = http.get(`${BASE_URL}/api/account/sessions`);
	check(sessions, {
		'sessions requires auth': (r) => r.status === 401 || r.status === 302
	});

	// OTP send — should be rate limited but return 200 (silent drop)
	const otpSend = http.post(
		`${BASE_URL}/api/auth/email-otp/send-verification-otp`,
		JSON.stringify({ email: `loadtest-${__VU}@example.com`, type: 'sign-in' }),
		{ headers: { 'Content-Type': 'application/json' } }
	);
	check(otpSend, {
		'otp send responds': (r) => r.status === 200 || r.status === 400 || r.status === 429 || r.status === 503
	});

	// Upload without auth — should return 401
	const upload = http.post(`${BASE_URL}/api/upload`, null);
	check(upload, {
		'upload requires auth': (r) => r.status === 401 || r.status === 302
	});

	sleep(1);
}
