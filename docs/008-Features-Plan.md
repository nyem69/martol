# Pre-Launch Feature Plan

**Date:** 2026-03-04
**Status:** Phases 0-4 complete. Phase 5 KIV. Phase 6 in progress (NCMEC blocking image uploads).
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

### Phase 0: Security Fixes (Week 1) -- DONE

Critical bugs found in code reviews. All resolved:

| Item | File | Status |
|------|------|--------|
| Agent self-approval gate | approve/reject endpoints + chat-room.ts | Fixed (round 2) — `agentUserId === locals.user.id` check in all 3 paths |
| TOCTOU race on approve/reject | approve/reject endpoints + chat-room.ts | Fixed (round 2) — atomic `UPDATE ... WHERE status = 'pending'` |
| Touch targets < 44px | `PendingActionLine.svelte` | Fixed — `flex items-center justify-center min-h-[44px] min-w-[44px]` |
| `role="alert"` storm | `PendingActionLine.svelte` | Fixed (round 2) — uses `role="group"` with `aria-label` |

**Exit criteria:** `pnpm check` + `pnpm build` pass.

---

### Phase 1: Security Narrative (Week 1-2) -- DONE

Zero engineering effort. Content pages that establish positioning before anyone sees the product.

| Deliverable | Route | Status |
|-------------|-------|--------|
| Landing page | `/` | Done — hero, feature list, CTA |
| Security page | `/security` | Done — comparison table, approval flow, role matrix, infra security |
| How It Works | `/how-it-works` | Skipped — covered by `/security` approval flow section |
| Comparison table | on `/security` | Done — embedded in security page |

**Exit criteria:** Pages deployed.

---

### Phase 2: Agent Simulation Engine (Week 2-4) -- DONE

The killer feature. Every agent action can be previewed, diffed, and risk-scored before a human approves it. This is what transforms martol from "secure chat for agents" into "the safe place to run autonomous AI."

All 4 sub-tasks complete: data model (simulationType, simulationPayload, riskFactors, estimatedImpact columns), MCP action_submit enhancement, PendingActionLine UI (renders all 5 simulation types), risk scoring engine.

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

### Phase 3: Chat Completeness (Week 3-4) -- DONE

Polish the core chat experience so it doesn't feel half-built when users arrive.

| Item | File(s) | Status |
|------|---------|--------|
| Image thumbnails in chat | `MessageBubble.svelte`, `markdown.ts` | Done — r2: URL rewrite, ImageModal lightbox |
| Multi-room switching | `ChatHeader.svelte`, `+page.server.ts` | Done — room switcher, create/rename, unread badges |
| Settings panel | `/settings/+page.svelte` | Done — username, sessions, passkeys, billing, data export, account deletion |
| Pull-to-load history | `MessageList.svelte`, `ChatView.svelte` | Done — cursor-based pagination, scroll-to-top trigger |
| Passkey support | `auth/index.ts`, `auth-client.ts` | Done — Better Auth 1.5 + @better-auth/passkey, settings UI, login button |

**Exit criteria:** All items complete.

---

### Phase 4: Stripe Integration (Week 4-6) -- DONE

Monetization. Build after simulation engine and chat polish — users need to hit free-tier limits before payment matters.

| Item | Status |
|------|--------|
| `subscriptions` table | Done — org_id, stripeCustomerId, plan, status, foundingMember, currentPeriodEnd |
| Feature gates | Done — `checkOrgLimits()` enforced in API endpoints (users, agents, messages, uploads) |
| Stripe Checkout | Done — `/api/billing/checkout` with role check, quantity = member count |
| Stripe Webhooks | Done — `/api/billing/webhook` handles all events, signature verified, idempotent |
| Customer Portal | Done — `/api/billing/portal` with role check |
| Billing UI | Done — Settings > Billing section with plan badge, usage stats, upgrade/manage buttons |
| Founding member pricing | Done — `founding_member` boolean, first 100 teams tracked |

**Pricing tiers:**

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | 5 users, 10 agents, 1000 msgs/day, 10 file uploads, 100 MB storage, 100 rooms/user |
| Pro | $10/user/mo | Unlimited users, agents, messages, uploads. 10 MB/file, 5 GB storage. RAG pipeline (50 doc process + 500 vector queries/mo included, $50 AI cap) |
| Governance | Contact us | Enterprise — listed on pricing page, not built |

**Promotion codes:** `PROFREE` (100% off), `BETA50` (50% off) — enabled via `allow_promotion_codes: true` on Checkout session.

**Exit criteria:** Free user hits limit -> upgrade prompt -> Stripe Checkout -> Pro features unlocked. Webhook handles renewals and cancellations.

---

### Phase 5: Distribution Prep (Week 5-7) -- KIV

Ship distribution mechanics BEFORE the HN launch. These create the viral loops.

| Item | Description | Status |
|------|-------------|--------|
| "Open in Martol" badge | GitHub badge: click -> create room for repo + agent + API key. Multiple rooms per repo allowed (different keys, isolated history). Slug uses random suffix to avoid cross-user collisions on the UNIQUE index. Rate limiting (not yet implemented) is the abuse control, not per-repo uniqueness. | Done |
| OpenClaw migration guide | Blog post: "Keep the Power, Lose the Risk" — how to move from local agents to governed execution | KIV — research at `_data/006-OpenClaw.md`, no blog infra |
| HN launch post | "Show HN: Martol — AI agents that show you what they'll do before they do it" | Done — `docs/show-hn.md` |
| Security incident response template | Pre-written blog post template: "Here's how martol prevents [X] class of attack" — ready for next agent security incident | Done — `docs/security-incident-template.md` |
| MCP registry listing | List martol's MCP endpoint in MCP directories/registries | Done — `docs/mcp-registry.md` ready, not yet submitted |

**Exit criteria:** Badge generates working room links. Migration guide published. HN post drafted and reviewed.

---

### Phase 6: Launch Hardening (Week 6-8)

Production readiness before opening the doors.

| Item | Description | Status |
|------|-------------|--------|
| Image scanning pipeline | Cloudflare Images + Workers AI for CSAM/NSFW detection. Blocks upload feature launch | Partial — scaffolding in `image-scan.ts`, placeholder model (resnet-50). Blocked by NCMEC |
| NCMEC registration | Legal requirement before accepting user-generated images | **BLOCKING** — plan at `docs/legal/NCMEC.md`, all items unchecked |
| Orphan R2 cleanup | Cron job: delete R2 objects with no DB reference older than 24h | Done — `worker-entry.ts` cron handler |
| Email change + 72-hour undo | Design exists. Implement: change request -> confirmation email -> 72h undo window | Done — full flow with dual email, revert, 30-day cooldown |
| Rate limit audit | Review all endpoints for appropriate limits. Ensure fail-closed (503) when KV unavailable | Done — 11 rate-limited paths, all critical paths fail-closed |
| Load testing | k6 scripts: 100 concurrent users, 10 rooms, 5 agents each. Target: < 200ms p95 message delivery | Done — HTTP p95=69ms (threshold 500ms), 100% checks pass. WS/MCP tests skip without agent API key |
| Sentry integration | Error tracking + performance monitoring in production | Done — client + worker + version metadata |
| Accessibility audit | WCAG 2.1 AA compliance on all interactive elements | Done — viewport zoom fixed, aria-labels added, keyboard-accessible message actions, fieldset legends |

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
| Abandoned room cleanup | See below — storage is negligible, query perf is the real cost |
| Room switcher pagination | Needed when users hit 20+ rooms; batch unread counts first |

### Abandoned Rooms (Post-Launch)

`/open` creates a fresh room + agent + API key on every click. No per-repo uniqueness — users can create multiple rooms for the same repo (different keys, isolated history). This is intentional.

**Cost per abandoned room:** 6 DB rows (~700 bytes - 4 KB with indexes). No Stripe/KV/R2/Durable Object cost — all lazy.

**The real cost is query performance.** The room switcher in `chat/+page.server.ts` loads all rooms and runs a separate `COUNT(*)` query per room for unread badges (N+1). A user with 50 rooms = 50 message count queries on every `/chat` page load.

**When to fix (trigger: users hitting 20+ rooms in analytics):**

1. **Batch unread counts** — single `GROUP BY` query instead of N+1:
   ```sql
   SELECT org_id, count(*) FROM messages
   WHERE org_id IN (...) AND id > last_read_id
   GROUP BY org_id
   ```
2. **Paginate room switcher** — show 10 most-recent rooms, "show all" toggle
3. **Archive stale rooms** — soft-delete orgs with 0 messages older than 90 days via hourly cron (already has a cron entry in `wrangler.toml`)

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
