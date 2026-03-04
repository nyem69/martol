# Security Narrative Pages — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update landing page hero + add security architecture section, create `/security` deep-dive page.

**Architecture:** Hybrid approach — landing page gets a rewritten hero and new security comparison section; `/security` is a standalone public page with the full architecture breakdown. All content uses i18n keys via paraglide.

**Tech Stack:** SvelteKit, Svelte 5 runes, Tailwind v4, paraglide i18n, CSS custom properties (OKLch), Lucide icons

---

### Task 1: Add i18n Keys

**Files:**
- Modify: `messages/en.json`

**Step 1: Add all i18n keys**

Add these keys to `messages/en.json` (before the closing `}`):

```json
"hero_tagline": "See what your AI agents will do — before they do it.",
"hero_subtitle": "Server-enforced governance for AI agents. Every action previewed, every decision audited.",
"section_security_title": "zero trust by design",
"section_security_unsafe": "Unsafe Agents",
"section_security_martol": "Martol",
"section_security_summary": "Martol's server-enforced architecture means agents never self-execute. Every action is validated, queued, and auditable.",
"section_security_cta": "Full security architecture",
"security_title": "Security Architecture",
"security_subtitle": "Every agent action is a structured intent validated by the server before execution.",
"security_problem_title": "the problem",
"security_problem_p1": "AI agents that run with your local privileges and decide what to execute are a single point of compromise.",
"security_problem_p2": "One hijacked session, one malicious plugin, one prompt injection — and the agent owns your machine.",
"security_problem_p3": "The problem isn't AI capability. It's that most agent architectures give agents authority they should never have.",
"security_comparison_title": "how martol is different",
"security_flow_title": "the approval flow",
"security_flow_step1_title": "Agent submits intent",
"security_flow_step1_desc": "Via MCP action_submit tool. Structured JSON with action type, description, and risk level.",
"security_flow_step2_title": "Server validates",
"security_flow_step2_desc": "Checks agent role against risk matrix. Low-risk from leads auto-approve. High-risk always queued.",
"security_flow_step3_title": "Action queued",
"security_flow_step3_desc": "Stored in pending_actions with status, risk level, and timestamp.",
"security_flow_step4_title": "Human reviews",
"security_flow_step4_desc": "Action appears inline in chat. Shows risk badge, description, and preview.",
"security_flow_step5_title": "Human decides",
"security_flow_step5_desc": "Approve, edit, or reject. Decision is role-gated.",
"security_flow_step6_title": "Server executes",
"security_flow_step6_desc": "Only after approval. Agent notified via action_status MCP tool.",
"security_flow_step7_title": "Audit logged",
"security_flow_step7_desc": "Action, approver, timestamp, role. Append-only, immutable.",
"security_roles_title": "role authority model",
"security_roles_note": "Agents never self-execute. Even low-risk actions go through the server validation path.",
"security_infra_title": "infrastructure security",
"security_infra_hmac": "HMAC-signed WebSocket identity — every connection carries cryptographic proof of user identity. No localhost hijacking.",
"security_infra_scoped": "Org-scoped rooms — agents can only see and act within their assigned room. No cross-org data leakage.",
"security_infra_session": "Session signing — X-Identity and X-Identity-Sig headers verified by Durable Object on every message.",
"security_infra_csp": "Content Security Policy — strict CSP: no inline scripts, no external images, frame-ancestors: none.",
"security_infra_ratelimit": "Rate limiting — per-user, per-IP, per-endpoint. Fails closed when unavailable.",
"security_infra_marketplace": "No skill marketplace — agents connect via authenticated MCP with API keys. No supply chain poisoning vector.",
"security_infra_audit": "Append-only audit — role changes, action approvals, and content reports logged immutably.",
"security_cta": "Try it",
"security_cta_github": "View source on GitHub",
"security_back": "Back to home"
```

**Step 2: Verify**

Run: `pnpm check 2>&1 | head -20`
Expected: paraglide compiles successfully (look for "Successfully compiled inlang project")

**Step 3: Commit**

```bash
git add messages/en.json
git commit -m "i18n: add security narrative page keys"
```

---

### Task 2: Update Landing Page Hero + Add Security Section

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Update imports and meta tags**

In the `<script>` block, add the paraglide import and `Lock` icon:

```typescript
import * as m from '$lib/paraglide/messages';
import { Lock } from '@lucide/svelte';
```

Update `<svelte:head>`:
- `<title>` → `Martol — See what your AI agents will do — before they do it`
- `og:title` → same
- `og:description` → `Server-enforced governance for AI agents. Every action previewed, every decision audited.`
- `twitter:title` → same
- `twitter:description` → same
- `description` meta → same as og:description
- Structured data `description` → same

**Step 2: Rewrite hero tagline and subtitle**

Replace the existing tagline/subtitle in the hero section:

Current:
```svelte
<p class="tagline">
    Chat with your AI agents<br />from anywhere.
</p>
<p class="subtitle">
    No SSH. No VPN. Just a browser.<span class="cursor">_</span>
</p>
```

New:
```svelte
<p class="tagline">
    {m.hero_tagline()}
</p>
<p class="subtitle">
    {m.hero_subtitle()}<span class="cursor">_</span>
</p>
```

**Step 3: Add security architecture section**

Insert a new `<section>` after the "HOW IT WORKS" section (after line 229's `</section>`) and before the "REAL EXAMPLE" section:

```svelte
<!-- SECURITY ARCHITECTURE -->
<section class="section" use:reveal>
    <div class="container">
        {@render sectionHead(m.section_security_title())}
        <div class="comparison-table-wrap">
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th></th>
                        <th class="col-unsafe">{m.section_security_unsafe()}</th>
                        <th class="col-martol">{m.section_security_martol()}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="row-label">Where agents run</td>
                        <td class="cell-unsafe">Your machine, your privileges</td>
                        <td class="cell-martol">Server-side, sandboxed per room</td>
                    </tr>
                    <tr>
                        <td class="row-label">What agents can do</td>
                        <td class="cell-unsafe">Anything — shell, files, network</td>
                        <td class="cell-martol">Only submit structured intents</td>
                    </tr>
                    <tr>
                        <td class="row-label">Who decides</td>
                        <td class="cell-unsafe">Agent decides and executes</td>
                        <td class="cell-martol">Server validates against role x risk matrix</td>
                    </tr>
                    <tr>
                        <td class="row-label">Dangerous actions</td>
                        <td class="cell-unsafe">Execute immediately</td>
                        <td class="cell-martol">Queued for human approval</td>
                    </tr>
                    <tr>
                        <td class="row-label">Audit trail</td>
                        <td class="cell-unsafe">Local logs (modifiable)</td>
                        <td class="cell-martol">Append-only server DB</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="security-summary">
            <Lock size={14} />
            <span>{m.section_security_summary()}</span>
        </p>
        <div class="security-cta-row">
            <a href="/security" class="security-link">
                {m.section_security_cta()} <ArrowRight size={14} />
            </a>
        </div>
    </div>
</section>
```

**Step 4: Update "How It Works" description**

Replace the existing diagram-note and aside text (lines 220-228):

Current:
```svelte
<div class="diagram-note">
    <ShieldCheck size={14} />
    <span>When agents want to do something risky — deploy, delete, modify — they ask first. You approve from the chat.</span>
</div>
<p class="aside">
    You and your AI agents share a chat room.<br />
    You talk. They work. You check in when you want.
</p>
```

New:
```svelte
<div class="diagram-note">
    <ShieldCheck size={14} />
    <span>Agents submit structured intents — not raw commands. The server validates every action against a role x risk matrix before anything executes.</span>
</div>
<p class="aside">
    Human previews the action with risk score. Approves, edits, or rejects.<br />
    Execution only after approval. Every decision audited.
</p>
```

**Step 5: Add "Security" to footer**

In the footer `<nav>`, add a Security link after GitHub:

```svelte
<nav class="footer-links" aria-label="Footer navigation">
    <a href="https://github.com/nyem69/martol" target="_blank" rel="noopener">GitHub</a>
    <a href="/security">Security</a>
    <a href="/legal/terms">Terms</a>
    <a href="/legal/privacy">Privacy</a>
    <a href="/legal/aup">Acceptable Use</a>
</nav>
```

**Step 6: Add CSS for comparison table and security section**

Add these styles in the `<style>` block (before the mobile media query):

```css
/* ── Comparison table ── */
.comparison-table-wrap {
    overflow-x: auto;
    margin-bottom: 20px;
    border: 1px solid var(--border);
    border-radius: 6px;
}

.comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-sans);
    font-size: 13px;
}

.comparison-table thead {
    background: var(--bg-elevated);
}

.comparison-table th {
    padding: 12px 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-align: left;
    border-bottom: 1px solid var(--border);
}

.comparison-table th:first-child {
    width: 30%;
}

.col-unsafe {
    color: var(--danger);
}

.col-martol {
    color: var(--success);
}

.comparison-table td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-subtle);
    line-height: 1.5;
}

.comparison-table tr:last-child td {
    border-bottom: none;
}

.row-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
}

.cell-unsafe {
    color: var(--text-muted);
}

.cell-martol {
    color: var(--text);
}

.security-summary {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0 0 16px;
}

.security-summary :global(svg) {
    color: var(--accent);
    flex-shrink: 0;
    margin-top: 3px;
}

.security-cta-row {
    text-align: center;
}

.security-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    text-decoration: none;
}

.security-link:hover {
    text-decoration: underline;
}
```

In the mobile media query (`@media (max-width: 640px)`), add:

```css
.comparison-table th:first-child {
    width: auto;
}
```

**Step 7: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: Only the pre-existing paraglide type error. No new errors.

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 8: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: rewrite landing page hero + add security architecture section"
```

---

### Task 3: Create `/security` Deep-Dive Page

**Files:**
- Create: `src/routes/security/+page.svelte`

**Step 1: Create the security page**

Create `src/routes/security/+page.svelte` with the full page content. The page structure:

1. `<svelte:head>` with title, meta description, OG tags
2. Scrollable wrapper (same pattern as landing page)
3. Header section: title + subtitle + back link
4. "The Problem" section: 3 paragraphs
5. "How Martol Is Different" section: 9-row comparison table
6. "The Approval Flow" section: 7 numbered step cards
7. "Role Authority Model" section: 4-row permission table
8. "Infrastructure Security" section: 7 bullet items with icons
9. CTA section: "Try it" + "View source on GitHub"

Use the same design patterns as the landing page:
- `sectionHead()` snippet for section labels
- `reveal()` action for scroll animations
- CSS custom properties for all colors
- `font-mono` for labels, `font-sans` for body
- Responsive table wrapping

The page should import:
```typescript
import * as m from '$lib/paraglide/messages';
import {
    ArrowLeft, ArrowRight, ShieldCheck, Lock, Eye,
    CheckCircle, XCircle, FileText, Server, Users
} from '@lucide/svelte';
```

Flow step cards should use numbered circles (same style as landing page `.step-num`) with title + description. Styled as a vertical timeline with left border.

Role authority table columns: Role | Low Risk | Medium Risk | High Risk | Can Approve Others. Use checkmarks/x-marks with color coding (success/danger).

Infrastructure bullets should use `Lock` icon with accent color, each item as a `<li>` with bold lead text and description.

**Step 2: Verify**

Run: `pnpm check 2>&1 | tail -15`
Expected: Only pre-existing errors.

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/routes/security/+page.svelte
git commit -m "feat: add /security deep-dive page"
```

---

### Task 4: Final Verification

**Step 1: Full build check**

Run: `pnpm check && pnpm build`
Expected: Both pass (only pre-existing paraglide type error).

**Step 2: Visual check**

Run: `pnpm dev`
- Navigate to `http://localhost:5190/` — verify hero shows new tagline, security section visible between "how it works" and "in action", footer has Security link
- Navigate to `http://localhost:5190/security` — verify all 7 sections render, tables scroll on mobile, scroll animations work
- Check responsive: resize to 640px width — tables should scroll horizontally, diagram should stack vertically

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: security narrative page adjustments"
git push
```
