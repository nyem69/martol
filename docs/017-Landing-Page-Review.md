# 017 — Landing Page Review

**Review date:** 2026-03-10
**Scope:** `src/routes/+page.svelte`
**Method:** Static review of homepage copy, structure, and claim accuracy against the current `martol` and `martol-client` code/docs

---

## Executive Summary

| Severity | Count |
|----------|-------|
| HIGH | 2 |
| MEDIUM | 1 |

The current landing page is visually solid, but the biggest issues are not layout bugs. The page currently makes stronger product and security claims than the implementation can safely support. That is the main risk: trust damage from overpromising.

---

## HIGH

### LP-01: The landing page overstates Martol's execution and security model

**Files**
- `src/routes/+page.svelte:82-109`
- `src/routes/+page.svelte:259-265`
- `src/routes/+page.svelte:289-313`
- `messages/en.json:252-257`
- `../martol-client/README.md:91-129`

The page currently claims or strongly implies:

- "See what your AI agents will do — before they do it."
- "Server-enforced governance for AI agents. Every action previewed, every decision audited."
- "Agents run server-side, sandboxed per room"
- "Only submit structured intents"
- "Execution only after approval. Every decision audited."

These statements are stronger than the current product can defend.

The neighboring `martol-client` repo documents Claude Code and Codex modes running against the user's current local project directory, not in a Martol-controlled server sandbox. Martol does enforce approval flow for structured actions, but it does not fully control or observe everything the local agent process does. The current messaging collapses those distinctions.

**Impact**
- Sets inaccurate expectations for new users.
- Creates avoidable trust risk if technical users compare the page to the actual architecture.
- Makes future incidents or edge-case behavior look like broken promises rather than product limitations.

**Recommendation**
- Reposition around what is clearly true today:
  - centralized shared chat
  - chat history
  - approval steps
  - restricted agent tools
  - multi-human plus multi-agent collaboration
- Avoid claims that imply full runtime control, full previewability, or complete observability of local agent behavior.

---

### LP-02: The governance section markets roadmap/aspirational capabilities as current product reality

**Files**
- `src/routes/+page.svelte:329-380`
- `src/routes/+page.svelte:366-369`
- `src/routes/+page.svelte:356-362`
- `src/routes/docs/pricing/+page.svelte:147-150`
- `docs/010-Features-Review.md:150`

The governance section includes claims such as:

- "Full audit trail"
- "Every prompt, intent, approval, and execution logged"
- "No local logs to tamper with"
- "SSO/SAML, custom retention policies, SLA guarantees, and on-premise deployment options"

These read as shipping product capabilities, not future plans or enterprise discussions.

At minimum, the "full audit trail" language is too absolute for the current architecture, and the enterprise-controls card reads like a feature list for functionality that is not clearly present in the product today.

**Impact**
- Users may buy into the wrong mental model of the product.
- Enterprise buyers may assume features exist that are not actually available.
- The page shifts from strong positioning into claim risk.

**Recommendation**
- Remove or soften anything not implemented and tested.
- If enterprise features are planned, label them as "available on request" or "roadmap" only if that is actually true operationally.
- Replace "full audit trail" with narrower wording such as "shared chat history and approval records."

---

## MEDIUM

### LP-03: Core positioning copy is duplicated across visible UI and metadata, which will drift

**Files**
- `src/routes/+page.svelte:81-113`
- `src/routes/+page.svelte:137-141`
- `messages/en.json:252-257`

The hero text is partially sourced from Paraglide keys, but the page `<title>`, meta description, Open Graph tags, Twitter tags, and JSON-LD description are hardcoded separately inside the route component.

That means a copy change requires editing multiple places by hand, and they will eventually drift apart.

This matters now because the current hero copy is actively being reconsidered.

**Impact**
- Metadata can become inconsistent with the visible hero.
- Search/social previews can continue advertising old positioning after the page copy changes.
- Copy iteration becomes more error-prone than it needs to be.

**Recommendation**
- Define one source of truth for landing-page positioning copy.
- Derive head metadata from the same values used in the hero, or at least centralize them in a local constant.

---

## Recommended Direction

The landing page should shift from "governance theater" to "shared AI workspaces" language.

The clearest defensible positioning today is:

- centralized chat for teams and AI agents
- shared history instead of siloed local agent sessions
- approval checkpoints for sensitive agent actions
- restricted tools and guided onboarding for new AI users
- visible collaboration between multiple humans and multiple agents

A simpler, more accurate message will likely convert better than claims that feel stronger but are hard to prove.

---

## Remediation Log

| Issue | Status | Fix | Files Changed | Date |
|-------|--------|-----|---------------|------|
| LP-01 | Fixed | Rewrote hero tagline/subtitle to "Stop coding in silos with your AI agents" / "Shared chat where your team and AI agents work together — with chat history, approval steps, and restricted tools." Updated all meta tags (title, OG, Twitter, JSON-LD) and i18n keys. Rewrote comparison table: "Server-side, sandboxed per room" → "Local machine, scoped to a shared room"; "Only submit structured intents" → "Chat + submit structured intents via restricted tools"; "Audit trail / Append-only server DB" → "History / Shared chat history on server". Softened diagram note and aside copy. | `messages/en.json`, `src/routes/+page.svelte` | 2026-03-10 |
| LP-02 | Fixed | Replaced governance lead copy ("No audit trail" → "No common history"). "Full audit trail" card → "Shared chat history" with accurate description. "Enterprise controls" card (SSO/SAML/SLA/on-premise) → "Team-friendly" card about onboarding and collaboration. Softened intent-note paragraph ("supervised" → "shared", "audit scope" → "restricted tools"). | `src/routes/+page.svelte` | 2026-03-10 |
| LP-03 | Partially addressed | Hero copy and all metadata updated together in the same commit. Full centralization into shared constants deferred as a future cleanup. | `messages/en.json`, `src/routes/+page.svelte` | 2026-03-10 |
