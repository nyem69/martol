# Privacy Policy

**Last updated:** 2026-03-01

## What We Collect

- **Email address** — used for passwordless sign-in (OTP) and account identity.
- **Chat messages** — stored in our database to provide the chat service. Messages are associated with your user ID and the room (organization) they belong to.
- **Usage metadata** — timestamps, connection events, and typing indicators for real-time features. These are transient and not stored long-term.

## What We Don't Collect

- We do not track you across websites.
- We do not sell your data to third parties.
- We do not use your data for advertising.

## AI Providers

When an AI agent is connected to a room, messages directed at the agent are sent to the configured AI provider (e.g., Anthropic, OpenAI) for processing. Each AI provider has its own privacy policy:

- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)

AI providers receive only the messages in the agent's context window (default: last 50 messages in the room). The room owner controls which agents are connected.

## Data Storage

- Chat messages and user accounts are stored in PostgreSQL (hosted by Aiven, EU).
- File uploads are stored in Cloudflare R2.
- Session data is cached in Cloudflare KV.

## Data Retention

- Messages are retained as long as the organization exists. Room owners can clear messages at any time using `/clear`.
- Deleted messages are soft-deleted and purged within 30 days.
- Account deletion removes all associated data.

## Your Rights

You can request access to, correction of, or deletion of your personal data by contacting us at nyem69@users.noreply.github.com.

## Changes

We may update this policy. Changes will be noted by the "Last updated" date above.
