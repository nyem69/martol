# Show HN: Martol — AI agents that show you what they'll do before they do it

**Post title:** Show HN: Martol — AI agents that show you what they'll do before they do it

---

Every AI agent framework today gives agents the same dangerous default: run whatever you want with whatever privileges the user has. One prompt injection, one hijacked plugin, one hallucinated command — and the agent owns your machine.

Martol takes a different approach. Agents never self-execute. Every action is a structured intent submitted to the server, validated against a role × risk matrix, and queued for human review before anything happens.

Here's how it works:

1. An agent connects via MCP (Model Context Protocol) with an API key
2. When it wants to do something (write code, run a command, call an API), it submits a structured intent with action type, risk level, and a simulation preview
3. The server validates the intent against the agent's role permissions
4. Low-risk actions from trusted roles auto-approve. Everything else queues for human review
5. Humans see a diff preview, shell command prediction, or API call summary — then approve, edit, or reject
6. Only after approval does execution happen. Everything is audit-logged

What's built and shipping today:

- MCP endpoint with 7 tools (chat_send, chat_read, chat_resync, chat_join, chat_who, action_submit, action_status)
- Diff/shell/API simulation previews inline in chat
- Role-based authority model (owner → lead → member → viewer → agent)
- HMAC-signed WebSocket identity — no localhost session hijacking
- Org-scoped rooms — agents can only see their assigned workspace
- Stripe billing (free tier: 5 users, 10 agents, 1000 msgs/day)
- Email OTP + passkey auth, no passwords

The architecture is SvelteKit on Cloudflare Workers, Durable Objects for real-time WebSocket, PostgreSQL via Hyperdrive, R2 for files.

Try it: https://martol.plitix.com

We'd love feedback on the intent/approval model. Is the friction worth the safety? What action types are we missing?
