/**
 * ChatRoom Durable Object — Stub
 *
 * Per-room WebSocket hub using Hibernation API.
 * This is a placeholder for wrangler to register the class.
 * Full implementation deferred to feature development.
 */

export class ChatRoom implements DurableObject {
	private state: DurableObjectState;
	private env: unknown;

	constructor(state: DurableObjectState, env: unknown) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		return new Response('ChatRoom not yet implemented', { status: 501 });
	}
}
