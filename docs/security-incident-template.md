# Security Incident Response Template

> Fill-in-the-blank blog post for publishing when the next AI agent security incident hits the news. Replace bracketed placeholders with incident details.

---

# [INCIDENT_NAME]: Why agent execution models are fundamentally broken

**Published:** [DATE]

## What happened

On [DATE], [COMPANY/RESEARCHER] disclosed [INCIDENT_NAME] — [ONE_SENTENCE_DESCRIPTION].

[2-3 SENTENCES EXPANDING ON THE INCIDENT: what the attacker did, what data/systems were compromised, how many users were affected.]

[LINK_TO_SOURCE_ARTICLE]

## Why this keeps happening

This is not a novel attack. It's the predictable result of giving AI agents unrestricted local execution privileges. When an agent can read your files, run shell commands, and make API calls with your credentials — the only thing between an attacker and your machine is a prompt.

The common thread across every agent security incident:

- **Agents self-execute** — they decide AND act, with no separation of concerns
- **Local privilege escalation** — agents inherit the user's full OS-level permissions
- **No preview mechanism** — users can't see what an agent will do before it does it
- **No audit trail** — there's no immutable record of what happened or who approved it

## How Martol prevents this

Martol was designed from day one around the assumption that agents will be compromised. The architecture ensures that even a fully hijacked agent cannot cause damage without human approval.

### Server-enforced intents

Agents never execute directly. Every action is a structured intent submitted to the server via MCP. The agent says "I want to modify `src/app.ts` with these changes" — it does not modify the file.

### Simulation preview

Before any human approves an action, they see exactly what will happen:

- **Code changes:** full diff preview (additions, deletions, file paths)
- **Shell commands:** command text + predicted side effects
- **API calls:** method, URL, headers, body preview

### Role × risk matrix

The server validates every intent against the role of the human who triggered the action:

| Triggering role | Low risk | Medium risk | High risk |
|---|---|---|---|
| **Owner** | Auto-approve | Auto-approve | Queue for review |
| **Lead** | Auto-approve | Queue | Queue |
| **Member** | Queue | Queue | Queue |
| **Viewer** | Reject | Reject | Reject |

Agents submit intents but never determine approval — the triggering human's role controls the outcome.

### HMAC-signed identity

Every WebSocket connection carries a cryptographic signature proving the sender's identity. There is no localhost session to hijack, no cookie to steal, no token to extract from environment variables.

### Append-only audit

Every action submission, approval, rejection, and execution is logged immutably. Role changes, content reports, and membership changes are all part of the audit trail. You can always reconstruct exactly what happened and who authorized it.

### No plugin marketplace

Agents connect via authenticated MCP with server-issued API keys. There is no skill marketplace, no community plugins, no supply chain to poison. The attack surface is the MCP protocol — which is server-validated, rate-limited, and scoped to a single organization.

## What you can do today

1. **Audit your agent permissions.** If your agent can `rm -rf /` without asking, you have a problem.
2. **Separate intent from execution.** The agent should request; a human (or policy engine) should approve.
3. **Try Martol.** [https://martol.plitix.com](https://martol.plitix.com)

## Technical deep dive

For a full walkthrough of our security architecture, see: [https://martol.plitix.com/security](https://martol.plitix.com/security)

## Vulnerability reporting

If you discover a security vulnerability in Martol, please report it responsibly:

- **Email:** security@plitix.com
- **Response time:** We aim to acknowledge reports within 24 hours and provide a fix timeline within 72 hours
- **Scope:** All Martol services at martol.plitix.com, the MCP endpoint, and the open-source client

We do not operate a bug bounty program at this time, but we will publicly credit researchers (with permission) in our security advisories.
