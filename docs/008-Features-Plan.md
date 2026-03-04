# Pre-Launch Feature Plan

**Date:** 2026-03-04
**Status:** Draft
**Inputs:** Business study (001), external review (002), startup myths (003), final review (004), codebase audit

---

## Positioning

> **AI agents that show you exactly what they'll do before they do it.**

Category: AI operations platform (AgentOps)
Differentiator: governed execution with simulation preview
Narrative: position against unsafe autonomous agents, not any specific product

---

## What's Already Built

The core infrastructure is production-ready:

- Email OTP login + age gate + terms versioning
- Multi-user chat with WebSocket (Durable Objects) + WAL persistence
- Server-enforced action approval (role x risk matrix)
- MCP endpoint with 7 tools (chat, actions, presence)
- File upload to R2 with magic byte validation + rate limiting
- HMAC-signed identity, CSP, security headers
- Role audit log, content reporting, user sanctions
- GDPR: account deletion + data export
- Invitation system with Better Auth organizations

---

## Pre-Launch: What Must Ship

### Phase 0: Security Fixes (Week 1)

Critical bugs found in code reviews that must be fixed before any users touch the system.

| Item | File | Description |
|------|------|-------------|
| Agent self-approval gate | `chat-room.ts` | Agents must not approve their own submitted actions. Add `submittedBy !== approverId` check |
| TOCTOU race on approve/reject | `api/actions/[id]/` | Both paths need atomic `UPDATE ... WHERE status = 'pending'` to prevent double-approve |
| Touch targets < 44px | Action cards, buttons | Add `min-height: 44px` on all interactive elements |
| `role="alert"` storm | `PendingActionLine.svelte` | Change to `role="group"` with `aria-label` — screen readers fire on every action card |

**Exit criteria:** `pnpm check` + `pnpm build` pass. Manual test: two browser tabs cannot both approve the same action.

---

### Phase 1: Security Narrative (Week 1-2)

Zero engineering effort. Content pages that establish positioning before anyone sees the product.

| Deliverable | Route | Purpose |
|-------------|-------|---------|
| Landing page | `/` | Product pitch, one-liner, architecture diagram, CTA to sign up |
| Security page | `/security` | Server-enforced authority model explained. How agents submit intents, not execute commands |
| How It Works | `/how-it-works` | Visual walkthrough: agent submits intent -> server validates -> human approves -> execution |
| Comparison table | on `/security` | Martol's architecture vs. unsafe autonomous agent model (local execution, no governance, no audit) |

**Design direction:** Industrial forge aesthetic (dark theme). Dense, technical, no marketing fluff. Target audience: developers who read architecture docs before signing up.

**Key copy points:**
- "See exactly what your AI agents will do — before they do it"
- "Server-enforced governance, not client-side guardrails"
- "Zero trust architecture: every action gated, every decision audited"

**Exit criteria:** Pages deployed. Share URL with 5 developers for feedback.

---

### Phase 2: Agent Simulation Engine (Week 2-4)

The killer feature. Every agent action can be previewed, diffed, and risk-scored before a human approves it. This is what transforms martol from "secure chat for agents" into "the safe place to run autonomous AI."

#### 2a. Simulation Data Model

Extend `pending_actions` to carry simulation payloads:

```
pending_actions (existing)
  + simulation_payload  JSONB   -- structured preview data from agent
  + simulation_type     TEXT    -- 'code_diff' | 'shell_preview' | 'api_call' | 'file_ops' | 'custom'
  + risk_factors        JSONB   -- array of { factor, severity, detail }
  + estimated_impact    JSONB   -- { files_modified, services_affected, reversible }
```

#### 2b. MCP `action_submit` Enhancement

Extend the existing `action_submit` tool to accept simulation metadata:

```json
{
  "action": "edit_file",
  "risk": "medium",
  "simulation": {
    "type": "code_diff",
    "preview": {
      "file": "src/auth.ts",
      "diff": "- old line\n+ new line",
      "lines_added": 3,
      "lines_removed": 1
    },
    "impact": {
      "files_modified": 1,
      "services_affected": ["auth"],
      "reversible": true
    },
    "risk_factors": [
      { "factor": "modifies_auth", "severity": "medium", "detail": "Changes authentication logic" }
    ]
  }
}
```

Agents that don't send simulation data still work — the approval card just shows the action description without a preview. Simulation is additive, not required.

#### 2c. Simulation Preview UI

Extend `PendingActionLine.svelte` to render simulation payloads:

| Simulation Type | Rendering |
|----------------|-----------|
| `code_diff` | Syntax-highlighted diff (green/red lines) |
| `shell_preview` | Command + predicted effects (files touched, services restarted) |
| `api_call` | Method, URL, headers, body preview |
| `file_ops` | File list with create/modify/delete indicators |
| `custom` | Agent-provided markdown rendered inline |

Each card shows:
- Agent name + role badge
- Action description
- Risk score (low/medium/high) with color indicator
- Expandable simulation preview
- Impact summary: "3 files modified, 1 service restart, reversible"
- Approve / Edit / Reject buttons (role-gated)

#### 2d. Risk Scoring Engine

Server-side risk assessment that augments agent-declared risk:

```
Agent declares risk: "low"
Server checks:
  - Action type in HIGH_RISK_ACTIONS? -> bump to "high"
  - Agent role has auto-approve for this level? -> skip queue
  - Simulation shows irreversible impact? -> bump risk
  - Multiple pending actions from same agent? -> flag
Final risk: "medium" (server override)
```

Risk factors displayed on the approval card so humans understand WHY the server flagged something.

**Exit criteria:** Agent submits action with simulation payload. Approval card renders diff preview. Risk score visible. Approve/reject works with simulation context.

---

### Phase 3: Chat Completeness (Week 3-4)

Polish the core chat experience so it doesn't feel half-built when users arrive.

| Item | File(s) | Description |
|------|---------|-------------|
| Image thumbnails in chat | `MessageBubble.svelte`, `markdown.ts` | Parse `![](r2:key)` -> `<img>` with 300px max-width. Click opens ImageModal |
| Multi-room switching | `ChatView.svelte`, `ChannelTabs.svelte` | Complete tab switching logic. LRU cache for room state. Unread badges |
| Settings panel | `SettingsOverlay.svelte` | Tabs: Profile, Members (invite/kick/roles), API Keys (create/revoke agents) |
| Pull-to-load history | `MessageList.svelte` | Cursor-based pagination. Load 50 older messages on scroll-to-top |
| Passkey support | `auth/index.ts` | Enable Better Auth `passkey` plugin. Add setup flow in settings |

**Exit criteria:** User can switch rooms, see unread counts, scroll through history, manage team members, and optionally add a passkey.

---

### Phase 4: Stripe Integration (Week 4-6)

Monetization. Build after simulation engine and chat polish — users need to hit free-tier limits before payment matters.

| Item | Description |
|------|-------------|
| `subscriptions` table | `org_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan` (free/pro), `status`, `current_period_end` |
| Feature gates | Check plan before: adding 4th user, 3rd agent, uploading files, exceeding 50 msgs/day |
| Stripe Checkout | `/api/billing/checkout` — create Stripe Checkout session for Pro plan |
| Stripe Webhooks | `/api/billing/webhook` — handle `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated/deleted` |
| Customer Portal | `/api/billing/portal` — redirect to Stripe billing portal for self-service |
| Billing UI | Settings > Billing tab — current plan, usage stats, upgrade/manage buttons |
| Founding member pricing | $5/user/mo for first 100 teams, locked 12 months. Track via `founding_member` boolean on subscription |

**Pricing tiers:**

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | 3 users, 2 agents, 50 msgs/day, no uploads |
| Pro | $8/user/mo (annual) / $10/user/mo (monthly) | Unlimited users, agents, messages. 10MB uploads, 5GB storage |
| Governance | Contact us | Enterprise — listed on pricing page, not built |

**Exit criteria:** Free user hits limit -> upgrade prompt -> Stripe Checkout -> Pro features unlocked. Webhook handles renewals and cancellations.

---

### Phase 5: Distribution Prep (Week 5-7)

Ship distribution mechanics BEFORE the HN launch. These create the viral loops.

| Item | Description |
|------|-------------|
| "Open in Martol" badge | GitHub badge/action: click -> create room for repo, connect agent via API key |
| OpenClaw migration guide | Blog post: "Keep the Power, Lose the Risk" — how to move from local agents to governed execution |
| HN launch post | "Show HN: Martol — AI agents that show you what they'll do before they do it" |
| Security incident response template | Pre-written blog post template: "Here's how martol prevents [X] class of attack" — ready for next agent security incident |
| MCP registry listing | List martol's MCP endpoint in MCP directories/registries |

**Exit criteria:** Badge generates working room links. Migration guide published. HN post drafted and reviewed.

---

### Phase 6: Launch Hardening (Week 6-8)

Production readiness before opening the doors.

| Item | Description |
|------|-------------|
| Image scanning pipeline | Cloudflare Images + Workers AI for CSAM/NSFW detection. Blocks upload feature launch |
| NCMEC registration | Legal requirement before accepting user-generated images |
| Orphan R2 cleanup | Cron job: delete R2 objects with no DB reference older than 24h |
| Email change + 72-hour undo | Design exists. Implement: change request -> confirmation email -> 72h undo window |
| Rate limit audit | Review all endpoints for appropriate limits. Ensure fail-closed (503) when KV unavailable |
| Load testing | k6 scripts: 100 concurrent users, 10 rooms, 5 agents each. Target: < 200ms p95 message delivery |
| Sentry integration | Error tracking + performance monitoring in production |
| Accessibility audit | WCAG 2.1 AA compliance on all interactive elements |

**Exit criteria:** Image uploads enabled. Load test passes. Sentry capturing errors. No WCAG AA violations on critical flows.

---

## Dependency Graph

```
Phase 0 (security fixes)
  |
  v
Phase 1 (security narrative) -----> Phase 5 (distribution prep)
  |                                      |
  v                                      v
Phase 2 (simulation engine) -----> Phase 6 (launch hardening)
  |                                      |
  v                                      |
Phase 3 (chat completeness)              |
  |                                      |
  v                                      |
Phase 4 (Stripe) ------------------> LAUNCH
```

Phase 1 and early Phase 2 can run in parallel.
Phase 5 depends on Phase 1 (need content before distribution).
Phase 6 runs alongside Phase 4-5.
Launch requires all phases complete.

---

## What's Explicitly NOT Pre-Launch

These are valuable but ship after launch based on user feedback:

| Feature | Why Deferred |
|---------|-------------|
| Full-text search | Nice-to-have; users search by scrolling in early days |
| Conversation export | No demand signal yet |
| Push notifications (Capacitor) | Mobile app is secondary channel |
| CLI (`martol connect`) | Power-user feature; API + MCP sufficient at launch |
| Public AI rooms | Network effect feature; needs users first |
| Cross-room agent coordination | Multi-room must work first |
| Collapsible threads | Chat UX polish; not blocking |
| OAuth providers (GitHub, Google) | Email OTP works; OAuth adds complexity |
| Self-hosted / Docker option | Enterprise feature; SaaS first |
| Webhooks (Slack, GitHub) | Integration feature; launch without |
| Additional locales | English-only at launch |

---

## Success Criteria at Launch

| Metric | Target |
|--------|--------|
| Landing page -> signup conversion | > 5% |
| Signup -> first message | > 60% |
| Signup -> agent connected | > 20% |
| Simulation preview used | > 30% of actions |
| Free-tier limit hit rate | > 30% of active teams |
| Day-7 retention | > 40% |
| First 30 days | 50 active teams |

---

## The One Thing That Matters Most

The simulation engine (Phase 2) is the product. Everything else is infrastructure.

If a developer sees:

```
Agent: code-agent
Action: edit auth.ts

Preview:
- line 32: old validation logic
+ line 32: new validation with rate limiting

Impact: 1 file modified, reversible
Risk: low

[Approve]  [Edit]  [Reject]
```

They understand the product instantly. No explanation needed. No marketing required.

That screenshot IS the launch post.
