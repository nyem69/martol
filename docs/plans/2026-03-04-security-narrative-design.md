# Security Narrative Pages — Design

**Date:** 2026-03-04
**Status:** Approved
**Approach:** Hybrid — update landing page hero + add security section; `/security` as deep-dive standalone

---

## Scope

Two deliverables:

1. **Landing page updates** — rewrite hero, add security architecture section, reframe "how it works", add footer link
2. **`/security` page** — new public route with full security architecture deep-dive

No `/how-it-works` as separate page — that content lives on the landing page (existing section, reframed).

---

## 1. Landing Page Updates

### Hero Rewrite

| Element | Current | New |
|---------|---------|-----|
| Tagline | "Chat with your AI agents from anywhere." | "See what your AI agents will do — before they do it." |
| Subtitle | (none) | "Server-enforced governance for AI agents. Every action previewed, every decision audited." |
| Hero image | Keep | Keep |
| Embers animation | Keep | Keep |
| Beta badge | Keep | Keep |
| CTA | "Get started" -> /login | Keep |

### New Section: "Security Architecture"

Insert after "How It Works", before "What You Get".

**Headline:** "Zero trust by design"

**Content:** Two-column comparison table — "Unsafe Agents" vs "Martol":

| Dimension | Unsafe Agents | Martol |
|-----------|---------------|--------|
| Where agents run | Your machine, your privileges | Server-side, sandboxed per room |
| What agents can do | Anything — shell, files, network | Only submit structured intents |
| Who decides | Agent decides and executes | Server validates against role x risk matrix |
| Dangerous actions | Execute immediately | Queued for human approval |
| Audit trail | Local logs (modifiable) | Append-only server DB |

Below the table: one-sentence summary + "Learn more" link to `/security`.

**Styling:** Same card-based approach as existing sections. Table uses CSS vars for alternating row contrast. No external product names — framed as architectural patterns.

### "How It Works" Reframe

Keep existing node-connector diagram. Update description text to emphasize:

1. Agent submits structured intent (not raw shell commands)
2. Server validates against role x risk matrix
3. Human previews the action with risk score
4. Execution only after approval

### Footer Update

Add "Security" link to footer nav, pointing to `/security`.

---

## 2. `/security` Page

### Route

- Path: `/security`
- Public (no auth required)
- Layout: standalone (not legal layout). Centered content, `max-w-4xl`, back-to-home link at top.

### Sections

#### 2.1 Header

- Title: "Security Architecture"
- One-liner: "Every agent action is a structured intent validated by the server before execution."

#### 2.2 The Problem

3-4 sentences. No product names. Framed as architectural flaw:

> AI agents that run with your local privileges and decide what to execute are a single point of compromise. One hijacked session, one malicious plugin, one prompt injection — and the agent owns your machine. The problem isn't AI capability. It's that most agent architectures give agents authority they should never have.

#### 2.3 Comparison Table

Expanded 9-row version (superset of landing page table):

| Dimension | Unsafe Agents | Martol |
|-----------|---------------|--------|
| Where agents run | Your machine, your privileges | Server-side, sandboxed per room |
| What agents can do | Anything — shell, files, network | Only submit structured intents |
| Who decides | Agent decides and executes | Server validates against role x risk matrix |
| Trust model | Trust the agent, hope for the best | Zero trust — every action gated by server |
| Dangerous actions | Execute immediately | Queued in pending_actions, require human approval |
| WebSocket security | Localhost, no auth | HMAC-signed identity, org-scoped, signature-expiring |
| Plugins/skills | Unvetted marketplace | No marketplace — agents connect via authenticated MCP |
| Multi-user | Single user, local | Multi-user with hierarchical roles |
| Audit trail | Local logs (modifiable) | Append-only server DB with role audit |

#### 2.4 The Approval Flow

Numbered step blocks (styled as vertical timeline or numbered cards):

1. **Agent submits intent** — via MCP `action_submit` tool. Structured JSON: action type, description, risk level, simulation payload.
2. **Server validates** — checks agent role against risk matrix. Low-risk actions from leads auto-approve. High-risk always queued.
3. **Action queued** — stored in `pending_actions` table with status `pending`, risk level, and timestamp.
4. **Human reviews** — action appears inline in chat timeline. Shows risk badge, description, and preview (diff, impact, risk factors).
5. **Human decides** — approve, edit, or reject. Decision is role-gated (members can't approve high-risk).
6. **Server executes** — only after approval. Agent notified via `action_status` MCP tool.
7. **Audit logged** — action, approver, timestamp, role at time of decision. Append-only, immutable.

#### 2.5 Role Authority Model

Table:

| Role | Low Risk | Medium Risk | High Risk | Can Approve Others |
|------|----------|-------------|-----------|-------------------|
| Owner | Auto-approve | Auto-approve | Auto-approve | Yes |
| Lead | Auto-approve | Auto-approve | Needs owner | Yes (low/medium) |
| Member | Needs approval | Needs approval | Needs approval | No |
| Agent | Submit only | Submit only | Submit only | Never |

Key point: agents NEVER self-execute. Even "low risk" actions go through the server validation path.

#### 2.6 Infrastructure Security

Bullet list:

- **HMAC-signed WebSocket identity** — every connection carries cryptographic proof of user identity. No localhost hijacking.
- **Org-scoped rooms** — agents can only see and act within their assigned room. No cross-org data leakage.
- **Session signing** — X-Identity + X-Identity-Sig headers verified by Durable Object on every message.
- **Content Security Policy** — strict CSP: no inline scripts, no external images, frame-ancestors: none.
- **Rate limiting** — per-user, per-IP, per-endpoint. Fails closed (503) when KV unavailable.
- **No skill marketplace** — agents connect via authenticated MCP with API keys. No supply chain poisoning vector.
- **Append-only audit** — role changes, action approvals, and content reports logged immutably.

#### 2.7 CTA

"Try it" button -> `/login`
Secondary: "View source on GitHub" -> repo link

---

## Design Constraints

- Use existing CSS custom properties (`--bg`, `--accent`, `--text`, `--text-muted`, `--border`, etc.)
- Geist Sans for body, Geist Mono for labels/code/technical terms
- Dark theme (forge aesthetic). No light mode concerns for public pages.
- Responsive: tables scroll horizontally on mobile or collapse to card layout
- No external images or tracking pixels (CSP: `img-src 'self' data: blob:`)
- All strings through paraglide i18n (`messages/en.json`)
- Svelte 5 runes only (`$state`, `$derived`, `$props`)

---

## i18n Keys Needed

Landing page:
- `hero_tagline`: "See what your AI agents will do — before they do it."
- `hero_subtitle`: "Server-enforced governance for AI agents. Every action previewed, every decision audited."
- `section_security_title`: "Zero trust by design"
- `section_security_cta`: "Learn more"

/security page:
- `security_title`: "Security Architecture"
- `security_subtitle`: "Every agent action is a structured intent validated by the server before execution."
- `security_problem_title`: "The Problem"
- `security_comparison_title`: "How Martol Is Different"
- `security_flow_title`: "The Approval Flow"
- `security_roles_title`: "Role Authority Model"
- `security_infra_title`: "Infrastructure Security"
- `security_cta`: "Try it"
- `security_cta_github`: "View source on GitHub"
- Plus table cell content keys

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/routes/+page.svelte` | Rewrite hero, add security section, reframe how-it-works, update footer |
| `src/routes/security/+page.svelte` | New: full security deep-dive page |
| `messages/en.json` | Add i18n keys for both pages |
| `src/hooks.server.ts` | Ensure `/security` is public (check if already covered by route pattern) |

No new components needed — content is inline in page files.
