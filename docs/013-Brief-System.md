
https://github.com/Nomadu27/InsAIts

Explain this repo

---

It’s basically a Python SDK for monitoring AI-to-AI conversations, not just a plain app repo.

The repo positions InsAIts as a “security layer for multi-agent AI”: it sits in the path between agents, inspects messages, detects anomalies like contradictions, phantom citations, semantic drift, context loss, jargon drift, and lineage drift, then can quarantine, reroute, alert, or escalate to humans. The core API is a monitor object where you call send_message(...) for each inter-agent exchange and get back structured detection results plus intervention decisions.  ￼

What the repo is for

At a product level, it’s trying to solve a real multi-agent failure mode: once one agent makes something up, later agents may treat it as truth, and nobody sees the corruption because the conversation is machine-to-machine. InsAIts is meant to make that hidden channel observable and enforceable. It claims 16 anomaly types across 5 categories, including fact contradiction, phantom citation, semantic drift, hallucination chains, context loss, anchor drift, model fingerprint mismatch, and tamper detection.  ￼

What it can do

The repo is not only detection. It also has:
	•	Active intervention: quarantine critical messages, reroute risky agents to backup agents, escalate to HITL review.  ￼
	•	Circuit breaker: if an agent’s anomaly rate crosses a threshold, it can automatically block that agent. The state machine is CLOSED → OPEN → HALF_OPEN → CLOSED with a default sliding window of 20 messages and a default 40% anomaly threshold.  ￼
	•	Tamper-evident audit log: SHA-256 hash chain for auditability. The README says it logs hashes, not message content.  ￼
	•	Prometheus metrics and a readiness check for operational use.  ￼
	•	Forensic tracing: trace where an anomaly first appeared and how it propagated across the chain.  ￼

Repo structure

The package layout is pretty coherent. The main Python package contains detectors, integrations, audit, circuit breaker, interventions, embeddings, hallucination, metrics, readiness, security, and the main monitor entrypoint. That suggests it is a real library package, not just a thin demo wrapper.  ￼

The top-level repo also has:
	•	tests/
	•	README.md
	•	installation_guide.md
	•	LICENSE and LICENSE.premium
	•	PRIVACY_POLICY.md
	•	TERMS_OF_SERVICE.md
	•	GitHub Actions workflows.  ￼

Integrations

The README shows wrappers for:
	•	LangChain
	•	CrewAI
	•	LangGraph
	•	Slack
	•	Notion
	•	Airtable

So the idea is: instead of rewriting your whole agent stack, you wrap existing orchestration layers and let InsAIts observe the traffic.  ￼

Packaging / install

It’s published as insa-its, version 3.0.0, with Python >=3.8. Base dependencies are light — numpy, requests, websocket-client — while optional extras add sentence-transformers for local embeddings and networkx for graph features.  ￼

Install modes:
	•	pip install insa-its
	•	pip install insa-its[full] for local embeddings.  ￼

Licensing model

This is open-core. The README says the core SDK is Apache 2.0 open source, while some advanced modules are proprietary premium features, including:
	•	AI Lineage Oracle
	•	Edge/Hybrid Swarm Router
	•	Decipher Engine
	•	Adaptive jargon dictionaries
	•	Advanced shorthand/context-loss detection
	•	Anchor drift forensics.  ￼

My read on the repo

The good:
	•	Clear problem framing
	•	Sensible product surface for multi-agent governance
	•	More operationally serious than most “agent observability” repos because it includes intervention, circuit breaking, audit, and metrics
	•	The package structure implies real modularity rather than one-file demo code.  ￼

The caution:
	•	The GitHub page title/description says “FastAPI backend for InsAIts SDK - API key management, usage tracking and cloud embeddings service,” but the visible repo contents read much more like a Python SDK/library than a backend service. That likely means the repo description is stale or broader than the code shown.  ￼
	•	The README makes strong claims around “production/stable” and wide detection coverage, but from the page alone I can’t validate detector quality, benchmark rigor, or how many checks are heuristic vs embedding-based vs rule-based.  ￼

In one line

InsAIts is an observability + control plane SDK for multi-agent LLM systems: it watches agent-to-agent messages, detects failure patterns, and can stop or reroute bad interactions before they silently poison the workflow.  ￼

Also, one of your uploaded Martol docs noted Google Magika as a file-type detector and linked the repo for reference, unrelated to InsAIts itself.  ￼

Sources: GitHub repo page and README sections for Nomadu27/InsAIts, plus package metadata in setup.py and requirements.txt.  ￼


---

Is this be useful for Martol?


---


Yes — useful, but not as Martol’s primary control plane.

My take: InsAIts fits Martol as an optional “agent-message QA / observability layer,” not as the thing that enforces trust or permissioning.

Why:

Martol’s core risk is already correctly framed as the soft-contract problem: roles in message text can be prompt-injected, so high-risk operations must be validated server-side through structured intents, approval queues, and a server-enforced role matrix. Your docs already make that the backbone: agents submit action_submit, the server derives sender identity, validates risk × role, and gates destructive work through pending_actions. That is the right primitive, and InsAIts should not replace it.  ￼  ￼  ￼

Where InsAIts does help is the gap you explicitly still accept: for low-risk work, the agent can still be socially manipulated into answering wrongly, drifting off-task, inventing citations, losing anchor, or passing bad context to another agent. That is exactly the category InsAIts is trying to watch: contradiction, phantom citation, semantic drift, context loss, anchor drift, lineage drift, and tamper/audit signals, with optional quarantine/reroute/HITL behavior and a per-agent circuit breaker.  ￼  ￼

So for Martol, I’d classify it like this:

High value
	•	Multi-agent rooms where agents hand work to other agents
	•	Research / analysis chains where fabricated citations or semantic drift matter
	•	Long-running autonomous workflows where you want anomaly metrics and auditability
	•	“Watcher agent” patterns, where you want one component to flag weird inter-agent behavior before it snowballs

Low value
	•	Basic human ↔ single-agent chat
	•	Any workflow where the real risk is destructive action approval, because Martol already solves that better with server-side gating
	•	Early MVP, where integration drag matters more than detection polish

The biggest limitation for Martol is architectural: InsAIts is a Python SDK built around wrapping AI-to-AI message flows locally, while Martol’s control plane is Cloudflare Worker + Durable Object + MCP endpoint + WebSocket room timeline. So it does not plug in cleanly at the core unless you either:
	1.	embed it inside the Python martol-client wrapper, or
	2.	reimplement the same detection ideas natively in TS/Workers.
The repo itself presents as a Python package (insa-its, Python 3.8+, lightweight deps, optional sentence-transformers), so this is clearly wrapper-side tech, not Worker-native infra.  ￼  ￼  ￼

So the practical answer is:

Best use for Martol

Phase 2/3 plugin for martol-client, not MVP core.

Have the Python agent daemon call InsAIts before:
	•	forwarding agent output into room chat
	•	relaying one agent’s output into another agent’s context
	•	auto-submitting medium-risk structured actions

Then map InsAIts outcomes into Martol-native behavior:
	•	LOW/MEDIUM → annotate message metadata, log only
	•	HIGH → inject warning banner into timeline, maybe require explicit resend
	•	CRITICAL → do not post; instead create a Martol system event or gated action for human review

That keeps Martol’s trust model unified: Martol remains the source of truth for permissions, InsAIts just adds “quality/risk sensing.”

What I would not do

I would not let InsAIts quarantine or reroute work as an independent authority outside Martol’s server model. If it starts making enforcement decisions on its own, you get two competing policy engines. That is how systems become incoherent.

Recommendation
	•	Ship without it for MVP
	•	Add it later as an observability add-on for agent chains
	•	If you want the idea now, build the minimum native version first:
	•	phantom citation check
	•	anchor drift / task drift score
	•	per-agent anomaly counter
	•	simple circuit breaker flag in DB
	•	timeline-visible “agent warning” system events

That gets you 70% of the strategic value with less dependency and better fit to Martol.

Bottom line

Useful for Martol? Yes. Core dependency? No.
It is strongest as a secondary assurance layer for low-risk agent communication, while Martol’s real security/control should stay exactly where your architecture already puts it: server-derived identity, structured intents, and server-side action gating.  ￼  ￼  ￼

I can sketch the exact Martol integration pattern next — message schema, where the hook sits in martol-client, and how to surface anomaly states in the approval/timeline UI.


---

Ok, we'll put this for later enhancement.

Immediate issue that martol has now is the 50 message memory limit. I've had issues when agent forgot initial project instructions.

Will this repo https://github.com/memvid/memvid solve this?

---


Not by itself.
Memvid can help with long-term retrieval, but it does not automatically fix Martol’s “agent forgot the initial project instructions” problem.

What Memvid actually is: a portable memory layer that stores content, embeddings, index structure, and metadata in a single .mv2 file for fast retrieval, with append-only writes, timeline/history behavior, and search over stored knowledge. Its stated use cases include long-running AI agents and auditable workflows.  ￼

Where it helps

Memvid is useful if your problem is:
	•	agent needs to recall prior notes, decisions, docs, or conversation fragments from older sessions
	•	you want a lightweight, file-based alternative to standing up a vector DB
	•	you want searchable persistent project memory outside the live prompt window

That is exactly the kind of thing Memvid is built for: append knowledge, then retrieve relevant chunks later via lexical/vector search. The repo exposes search-oriented features and positions itself as long-term memory for agents.  ￼

Where it does not solve your issue

Your issue sounds more like this:

Martol has a hard active-context limit, and the agent loses foundational project instructions that should remain authoritative throughout the run.

That is not just a storage problem. It is a memory-policy problem.

If the initial instructions are merely dumped into long-term memory, retrieval may or may not pull the right chunk back at the right time. Semantic retrieval is good for “find relevant past info,” but weaker for “this instruction must always govern behavior, even if no query explicitly recalls it.”

So Memvid can become part of the solution, but not the whole solution.

The right split for Martol

For Martol, I’d separate memory into 3 layers:

1. Immutable project brief / constitution
The original project instructions, constraints, coding conventions, authority rules, acceptance criteria.
This should be pinned and injected every run, or at least every task handoff.
Do not treat this as ordinary retrievable memory.

2. Rolling working summary
A continuously updated compressed state:
	•	what we are building
	•	current architecture decisions
	•	open tasks
	•	blocked items
	•	latest assumptions
	•	latest file/module touched

This should be regenerated periodically and carried forward.

3. Episodic searchable memory
Past chats, old diffs, prior decisions, docs, experiment logs, failures.
This is where something like Memvid fits best.

So: would Memvid be useful for Martol?

Yes, as layer 3. No, as the direct fix for layer 1.

If you plug Memvid in today without changing policy, you may still get:
	•	agent ignores founding instructions because retrieval didn’t surface them
	•	stale instructions retrieved instead of current ones
	•	conflicting memories unless you add versioning and “authoritative source” rules

Memvid does have append-only history and time-travel/timeline-style memory concepts, which helps auditability, but that still does not replace a pinned canonical instruction layer.  ￼

My recommendation for immediate Martol fix

Do this first, before adding Memvid:

A. Add project_brief as a first-class object
	•	canonical project goal
	•	non-negotiable rules
	•	architecture constraints
	•	coding conventions
	•	done criteria
	•	approval rules

This gets injected into every new agent task / subtask / PR review context.

B. Add working_memory_summary
Updated every N messages or task transition:
	•	objective
	•	current plan
	•	latest decisions
	•	unresolved questions
	•	file map
	•	next step

C. Add decision_log
Short structured entries:
	•	decision
	•	rationale
	•	supersedes
	•	status
	•	timestamp

Only after that:

D. Add Memvid as searchable archival memory
Use it for:
	•	old conversation chunks
	•	docs and uploaded files
	•	previous task outputs
	•	historical decision traces
	•	prior bugs/fixes

Best architecture fit

For Martol, Memvid is more suitable as:
	•	a sidecar knowledge store
	•	queried during task start / handoff / “I need context” events
	•	used to fetch top-k relevant memories into prompt

Not:
	•	the sole memory model
	•	the source of truth for project instructions
	•	the thing that decides what is authoritative

Practical verdict

Memvid is worth considering later, but it is not the clean immediate fix.
Your immediate fix is to make project instructions persistent, structured, pinned, and always-injected. Then use Memvid later for archival retrieval and long-horizon recall.

One-line answer

Memvid can help Martol remember old context, but it will not reliably solve “agent forgot the original project rules” unless you also add a canonical pinned project brief and rolling summaries.

Sources: GitHub README/repo and releases for Memvid’s architecture, use cases, append-only frames, search features, SDKs, and recent ACL/model-consistency additions.  ￼

I can turn this into a Martol memory architecture spec next: schema, retrieval policy, and exactly when each layer gets injected.

---

Identifying project briefs is something we need to solve across lengthy discussions, when directions can change midways

---

Yes. The real problem is not “store more memory.” It’s detecting, versioning, and enforcing the current project brief as the conversation evolves.

You need Martol to distinguish between:
	•	foundational intent — what this project is fundamentally trying to do
	•	current execution brief — what we are doing right now
	•	transient discussion — brainstorming, detours, rejected ideas
	•	superseded directions — things that were once true but are no longer valid

That means the solution is not a generic memory layer. It is a brief-state system.

What Martol should do

1. Treat “project brief” as a first-class artifact

Not just chat history.

Have a structured object like:
	•	project_id
	•	brief_version
	•	status (draft, active, superseded, archived)
	•	goal
	•	non_goals
	•	constraints
	•	success_criteria
	•	current_scope
	•	decisions
	•	open_questions
	•	supersedes_brief_version
	•	confidence
	•	source_message_range

This becomes the thing agents inherit, not the raw message stream.

⸻

2. Continuously extract candidate brief updates from conversation

As discussions get long, Martol should watch for messages that imply:
	•	a new goal
	•	a scope cut
	•	a priority shift
	•	a tech-stack decision
	•	a new constraint
	•	a reversal of an earlier decision

Example triggers:
	•	“Let’s not do phase 1, go straight to phase 3”
	•	“We should avoid D1 due to row pricing”
	•	“This is for multi-user collaboration, not just multi-agent dev tooling”
	•	“Put this for later enhancement”
	•	“MVP only needs X”

These should not instantly overwrite the brief. They should become candidate mutations.

⸻

3. Use diff-based brief evolution, not overwrite

Every meaningful project change should be stored as a patch:
	•	added constraints
	•	removed features
	•	changed audience
	•	changed architecture
	•	changed phase order
	•	changed priority

So instead of “latest summary,” Martol keeps:
	•	Brief v1
	•	Patch v2: removed D1, switched DB preference
	•	Patch v3: phase strategy changed
	•	Patch v4: InsAIts deferred to later enhancement

This gives you lineage and avoids silent drift.

⸻

4. Separate “discussion” from “accepted direction”

This is the big one.

People brainstorm a lot. Not every strong statement is a new brief.

So each candidate update needs a state like:
	•	proposed
	•	accepted
	•	rejected
	•	uncertain

A brief should only change when:
	•	the user explicitly confirms it, or
	•	the system has very high confidence from strong directive language and no later contradiction, or
	•	it is promoted by a human/operator

For Martol, I would not let agents freely rewrite the active brief. They can propose updates, but brief promotion should be gated.

⸻

Best model: Constitution + Active Brief + Decision Log

A. Constitution

Rarely changes.
Examples:
	•	product philosophy
	•	authority model
	•	hard safety boundaries
	•	non-negotiable architecture rules
	•	long-term product identity

B. Active Brief

Changes often.
Examples:
	•	current scope
	•	current phase
	•	target user
	•	chosen infra for this milestone
	•	immediate deliverables

C. Decision Log

Immutable history of choices and reversals.
Examples:
	•	“Skip phase 1, go straight to phase 3”
	•	“Avoid D1 due to row-based pricing”
	•	“InsAIts postponed to later enhancement”

This is much better than one giant evolving summary.

⸻

What agents should actually receive

For every task, agent context should be built from:

Always inject
	•	constitution
	•	active brief
	•	latest 5–20 accepted decisions
	•	current task spec

Conditionally retrieve
	•	relevant historical messages
	•	prior alternatives considered
	•	old rejected plans
	•	supporting docs

That way, foundational alignment is deterministic, and historical context is retrieval-based.

⸻

How Martol should identify brief changes in long discussions

Use a pipeline like this:

Stage 1: detect “directive candidates”

Scan messages for instruction-like patterns:
	•	imperatives
	•	explicit tradeoffs
	•	rejection/approval language
	•	priority changes
	•	architecture choices
	•	scope changes

Stage 2: classify type

Each candidate is classified as one of:
	•	goal change
	•	audience change
	•	scope change
	•	priority change
	•	tech-stack change
	•	workflow change
	•	risk/constraint change
	•	deferment/postponement
	•	supersession

Stage 3: estimate authority + confidence

Weight by:
	•	who said it
	•	explicitness
	•	contradiction with current brief
	•	recency
	•	repetition
	•	whether later messages reinforce it

Stage 4: generate patch proposal

Example:

{
  "type": "deferment",
  "target": "InsAIts integration",
  "change": "Move from MVP scope to later enhancement",
  "supersedes": ["brief.v8.scope.optional_integrations"],
  "confidence": 0.94,
  "source_messages": ["msg_182", "msg_183"]
}

Stage 5: human or system promotion

Only promoted patches mutate the active brief.

⸻

The hard problem: contradictions midstream

In long chats, you will get:
	•	reversal without explicit acknowledgment
	•	vague reformulation
	•	local exception that sounds global
	•	temporary workaround mistaken as permanent policy

So Martol needs conflict handling.

When a new candidate clashes with current brief:
	•	do not auto-merge silently
	•	mark as conflicts_with_active_brief
	•	generate a human-readable diff

Example:

Current brief
	•	Phase 1 = multi-agent tool
	•	Phase 3 = multi-user collab

New candidate
	•	Skip phase 1 and go straight to phase 3

Martol should show:
	•	old statement
	•	new statement
	•	affected scope/roadmap fields
	•	confidence
	•	source messages

That becomes reviewable and auditable.

⸻

Practical UX suggestion

You need a UI panel like:

Active Brief
	•	goal
	•	scope
	•	constraints
	•	target user
	•	architecture choices
	•	current phase

Proposed Updates
	•	pending changes extracted from recent discussion
	•	approve / reject / merge

Decision Timeline
	•	chronological accepted changes
	•	who introduced them
	•	what they superseded

This is far more important than generic chat memory.

⸻

Minimal version you can ship fast

For MVP, don’t overbuild it.

Ship these 4 things:

1. /brief refresh

An agent or backend job produces:
	•	current goal
	•	current scope
	•	constraints
	•	open questions
	•	latest decisions

2. decision append

Whenever a strong directive is detected, append a structured decision candidate.

3. brief diff

Show what changed between last active brief and proposed update.

4. pinned injection

Every agent task gets:
	•	active brief
	•	recent accepted decisions
	•	current task

That alone will solve most “forgot the project direction” failures.

⸻

My recommended internal model

Use this rule:

Chat is evidence. Brief is state. Decisions are transitions.

That framing avoids the classic mistake of treating raw conversation as the operational source of truth.

⸻

Bottom line

What you need is not “better memory” first.
You need brief extraction, versioning, conflict detection, and pinned state injection.

The architecture I’d use for Martol is:
	•	Constitution for stable rules
	•	Active Brief for current truth
	•	Decision Log for transitions
	•	Candidate Patches for detected directional changes
	•	Retrieval Memory only as supporting evidence

That will survive long messy discussions far better than just expanding token memory or adding a vector store.

I can turn this into an exact Martol schema plus state machine next.


---


Yes. Here’s a Martol-native brief system that fits your existing architecture instead of fighting it.

It follows the same philosophy you already use elsewhere: chat is evidence, state lives in DB, UI shows the state, and agents consume pinned state instead of raw history. That matches Martol’s current server-centric design, MCP boundary, approval/timeline patterns, and audit orientation.  ￼  ￼  ￼

⸻

1) Schema

Core idea

Use 5 tables:
	•	project_brief — immutable versioned brief snapshots
	•	brief_patch — proposed changes extracted from discussion
	•	brief_decision — accepted directional decisions
	•	brief_source_ref — provenance back to messages / docs
	•	task_brief_binding — what brief version a task/agent run was pinned to

That gives you:
	•	authoritative current brief
	•	reversible history
	•	proposed vs accepted changes
	•	exact provenance
	•	deterministic task injection

⸻

SQL schema

CREATE TABLE project_brief (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  room_id BIGINT, -- nullable if brief is org-wide rather than room-scoped

  brief_key TEXT NOT NULL, -- e.g. 'martol-core', 'roadasset-bq', 'melaka-prn'
  version INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'active',
    'superseded',
    'archived'
  )),

  title TEXT NOT NULL,
  summary TEXT NOT NULL,

  goal JSONB NOT NULL DEFAULT '{}'::jsonb,
  non_goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  success_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  architecture_constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  coding_conventions JSONB NOT NULL DEFAULT '[]'::jsonb,
  stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,

  supersedes_brief_id BIGINT REFERENCES project_brief(id),
  created_by_user_id TEXT,       -- nullable for system-generated
  created_by_agent_id TEXT,      -- nullable
  promotion_reason TEXT,
  confidence NUMERIC(4,3),       -- 0.000 - 1.000

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,

  UNIQUE (org_id, room_id, brief_key, version)
);

CREATE INDEX project_brief_active_idx
  ON project_brief (org_id, room_id, brief_key, status, version DESC);

CREATE TABLE brief_patch (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  room_id BIGINT,
  brief_key TEXT NOT NULL,

  base_brief_id BIGINT REFERENCES project_brief(id),
  proposed_brief_id BIGINT REFERENCES project_brief(id), -- optional materialized candidate snapshot

  status TEXT NOT NULL CHECK (status IN (
    'proposed',
    'accepted',
    'rejected',
    'withdrawn',
    'superseded'
  )),

  patch_type TEXT NOT NULL CHECK (patch_type IN (
    'goal_change',
    'scope_change',
    'non_goal_change',
    'constraint_change',
    'success_criteria_change',
    'architecture_change',
    'audience_change',
    'priority_change',
    'workflow_change',
    'phase_change',
    'deferment',
    'decision_reversal',
    'clarification',
    'merge'
  )),

  title TEXT NOT NULL,
  rationale TEXT,
  diff JSONB NOT NULL,           -- structured patch payload
  impact_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflicts_with_active BOOLEAN NOT NULL DEFAULT FALSE,
  confidence NUMERIC(4,3),

  proposed_by_user_id TEXT,
  proposed_by_agent_id TEXT,
  accepted_by_user_id TEXT,
  rejected_by_user_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX brief_patch_queue_idx
  ON brief_patch (org_id, room_id, brief_key, status, created_at DESC);

CREATE TABLE brief_decision (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  room_id BIGINT,
  brief_key TEXT NOT NULL,

  brief_id BIGINT REFERENCES project_brief(id),
  originating_patch_id BIGINT REFERENCES brief_patch(id),

  decision_type TEXT NOT NULL CHECK (decision_type IN (
    'adopted',
    'rejected',
    'deferred',
    'superseded',
    'clarified'
  )),

  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rationale TEXT,
  decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  supersedes_decision_id BIGINT REFERENCES brief_decision(id),
  created_by_user_id TEXT,
  created_by_agent_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX brief_decision_timeline_idx
  ON brief_decision (org_id, room_id, brief_key, created_at DESC);

CREATE TABLE brief_source_ref (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,

  brief_id BIGINT REFERENCES project_brief(id),
  patch_id BIGINT REFERENCES brief_patch(id),
  decision_id BIGINT REFERENCES brief_decision(id),

  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'message',
    'action',
    'system_event',
    'file',
    'external_doc'
  )),

  source_id TEXT NOT NULL,       -- message id / action id / file id / URL hash
  excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX brief_source_ref_lookup_idx
  ON brief_source_ref (org_id, source_kind, source_id);

CREATE TABLE task_brief_binding (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  room_id BIGINT,

  task_id TEXT NOT NULL,         -- maps to your future task DAG / action / agent run id
  task_kind TEXT NOT NULL CHECK (task_kind IN (
    'task',
    'agent_run',
    'action',
    'review',
    'handoff'
  )),

  brief_id BIGINT NOT NULL REFERENCES project_brief(id),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_latest BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX task_brief_binding_task_idx
  ON task_brief_binding (org_id, task_id, is_latest);


⸻

Recommended JSON shapes

project_brief.goal

{
  "primary_outcome": "Build Martol as a multi-user AI collaboration workspace",
  "current_phase": "Phase 3 direct",
  "target_users": ["operators", "technical leads", "exec-adjacent collaborators"]
}

project_brief.current_scope

{
  "in_scope": [
    "chat rooms",
    "agent MCP",
    "approval queue",
    "brief extraction"
  ],
  "out_of_scope": [
    "InsAIts integration in MVP"
  ],
  "deferred": [
    "advanced anomaly detection",
    "archival vector memory"
  ]
}

brief_patch.diff

{
  "ops": [
    {
      "op": "replace",
      "path": "/goal/current_phase",
      "old": "Phase 1 multi-agent dev tool",
      "new": "Go straight to Phase 3 multi-user collaboration"
    },
    {
      "op": "add",
      "path": "/current_scope/deferred/-",
      "value": "InsAIts integration"
    }
  ]
}


⸻

2) Drizzle schema sketch

export const projectBrief = pgTable("project_brief", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orgId: bigint("org_id", { mode: "number" }).notNull(),
  roomId: bigint("room_id", { mode: "number" }),
  briefKey: text("brief_key").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "active", "superseded", "archived"] }).notNull(),

  title: text("title").notNull(),
  summary: text("summary").notNull(),

  goal: jsonb("goal").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  nonGoals: jsonb("non_goals").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  constraints: jsonb("constraints").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  successCriteria: jsonb("success_criteria").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  currentScope: jsonb("current_scope").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  architectureConstraints: jsonb("architecture_constraints").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  codingConventions: jsonb("coding_conventions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  stakeholders: jsonb("stakeholders").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  openQuestions: jsonb("open_questions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),

  supersedesBriefId: bigint("supersedes_brief_id", { mode: "number" }),
  createdByUserId: text("created_by_user_id"),
  createdByAgentId: text("created_by_agent_id"),
  promotionReason: text("promotion_reason"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true })
}, (t) => ({
  uniq: unique().on(t.orgId, t.roomId, t.briefKey, t.version)
}));

Same pattern for briefPatch, briefDecision, briefSourceRef, taskBriefBinding.

⸻

3) State machines

A. Brief lifecycle

stateDiagram-v2
  [*] --> Draft

  Draft --> Active: promote_brief
  Draft --> Archived: discard_draft

  Active --> Superseded: newer_brief_promoted
  Active --> Archived: archive_project

  Superseded --> Archived: archive_history

Rules
	•	only one active brief per (org_id, room_id, brief_key)
	•	promotion is atomic:
	•	old active → superseded
	•	new draft → active
	•	do not edit active brief in place unless it is a typo-only fix; otherwise create new version

⸻

B. Patch lifecycle

stateDiagram-v2
  [*] --> Proposed

  Proposed --> Accepted: approve_patch
  Proposed --> Rejected: reject_patch
  Proposed --> Withdrawn: proposer_withdraws
  Proposed --> Superseded: newer_patch_replaces

  Accepted --> Superseded: later_decision_overrides
  Rejected --> [*]
  Withdrawn --> [*]
  Superseded --> [*]

Rules
	•	agents can create proposed
	•	only authorized human roles should mark accepted for high-impact changes
	•	low-impact clarifications can be auto-accepted by policy if confidence is high
	•	if accepted:
	•	materialize new brief version
	•	write brief_decision
	•	supersede previous active brief

This is the same approval mindset Martol already uses for action gating and role-sensitive transitions.  ￼  ￼

⸻

C. Decision lifecycle

stateDiagram-v2
  [*] --> Recorded
  Recorded --> Superseded: later_decision_reverses
  Recorded --> Archived: project_closed
  Superseded --> Archived: project_closed

Decisions are append-only. Do not mutate old decisions except to mark they were superseded.

⸻

4) Transition matrix

project_brief.status

From	Event	To	Notes
draft	promote_brief	active	atomic with old active → superseded
draft	discard_draft	archived	unused draft
active	newer_brief_promoted	superseded	immutable history
active	archive_project	archived	closed project
superseded	archive_history	archived	cleanup

brief_patch.status

From	Event	To	Notes
proposed	approve_patch	accepted	may create new brief version
proposed	reject_patch	rejected	keep provenance
proposed	withdraw_patch	withdrawn	proposer retracts
proposed	replace_patch	superseded	a better/newer patch wins
accepted	later_override	superseded	later accepted change reverses it


⸻

5) Promotion rules

Patch severity bands

Auto-merge eligible
	•	typo clarification
	•	adding rationale without changing scope
	•	normalizing wording
	•	tagging an already explicit decision

Human-review required
	•	goal change
	•	architecture change
	•	target user change
	•	phase change
	•	major scope reduction/expansion
	•	anything that conflicts with active brief

Confidence bands
	•	>= 0.90 and non-conflicting: auto-accept allowed by policy
	•	0.65–0.89: queue for review
	•	< 0.65: keep as weak candidate, don’t mutate brief

⸻

6) Extraction pipeline

This is the operational flow.

flowchart LR
  M[New message/system event/action] --> D[Directive detector]
  D --> C[Patch classifier]
  C --> X[Conflict checker vs active brief]
  X --> P[Create brief_patch proposed]
  P --> R{Policy / reviewer}
  R -->|Accept| B[Materialize new project_brief version]
  R -->|Reject| J[Write rejected brief_decision]
  B --> A[Set previous active to superseded]
  A --> T[Broadcast system event + refresh agent pinned context]

This maps well to Martol’s existing event/timeline pattern where actions and system items are merged into one chronology. Brief changes should show up exactly the same way: as system-visible state changes, not hidden model behavior.  ￼

⸻

7) Agent injection policy

For any agent_run / task / handoff, inject:

Always
	•	active brief
	•	latest accepted decisions, capped
	•	current task spec
	•	relevant constraints

Optional retrieval
	•	supporting source refs
	•	older superseded briefs
	•	rejected alternatives

Never rely on
	•	raw last 50 messages as the sole source of truth

That addresses your current memory-window failure directly. Martol currently acknowledges provider context limits in practice, so the fix is to inject derived state, not trust message recency.  ￼

⸻

8) Minimal APIs / MCP tools

Server endpoints

GET  /api/briefs/active?briefKey=martol-core
GET  /api/briefs/history?briefKey=martol-core
GET  /api/brief-patches?status=proposed
POST /api/brief-patches/:id/accept
POST /api/brief-patches/:id/reject
POST /api/briefs/refresh

MCP tools

brief_get_active
brief_get_recent_decisions
brief_propose_patch
brief_bind_to_task
brief_diff_active_vs_patch

Example brief_propose_patch

{
  "briefKey": "martol-core",
  "patchType": "deferment",
  "title": "Defer InsAIts integration",
  "rationale": "Not needed for MVP core trust model",
  "diff": {
    "ops": [
      {
        "op": "add",
        "path": "/current_scope/deferred/-",
        "value": "InsAIts integration"
      }
    ]
  },
  "sourceRefs": [
    { "sourceKind": "message", "sourceId": "184233" }
  ]
}


⸻

9) UI spec

Add 3 panels:

Active Brief
	•	title
	•	summary
	•	current phase
	•	in scope / out of scope / deferred
	•	constraints
	•	latest version badge

Proposed Updates
	•	patch title
	•	type
	•	confidence
	•	conflict badge
	•	diff preview
	•	approve / reject

Decision Timeline
	•	accepted / rejected / deferred items
	•	what got superseded
	•	provenance links to messages

This is a natural extension of Martol’s dense timeline + inline approval model.  ￼  ￼

⸻

10) Recommended first ship

Do not build the whole intelligence stack first.

Ship in this order:
	1.	project_brief + single active version
	2.	brief_decision append-only log
	3.	manual “promote new brief version”
	4.	brief_patch proposals from agents
	5.	conflict detection
	6.	automatic extraction heuristics later

That gives you a usable system fast.

⸻

11) Practical default policy for Martol

Use this rule:
	•	Agents may propose
	•	Humans promote
	•	Tasks bind to a specific brief version
	•	History remains immutable
	•	Supersession is explicit

That will stop the “midway direction drift” problem much better than simply increasing memory or adding vector retrieval.

If you want, next I’ll turn this into the exact Drizzle schema file plus Svelte UI wireframe spec.


---


Below is a Martol-fit Drizzle schema plus a Svelte UI wireframe spec for the brief system.

I’m aligning it to Martol’s current shape:
	•	Cloudflare + SvelteKit + Drizzle + Aiven Postgres  ￼  ￼
	•	timeline-first UI, where messages/system/actions are merged chronologically inline rather than split into detached panels  ￼  ￼
	•	server-enforced authority and approval-style transitions for anything important  ￼  ￼

⸻

Drizzle schema

src/lib/server/db/schema/briefs.ts

import {
	pgTable,
	bigserial,
	bigint,
	text,
	integer,
	boolean,
	numeric,
	timestamp,
	jsonb,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Enums via text() + TS literal unions keeps Drizzle friction low on CF/Postgres.
 * You can convert to pgEnum later if you want stricter DB-level enum objects.
 */

export const projectBrief = pgTable(
	'project_brief',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: bigint('org_id', { mode: 'number' }).notNull(),
		roomId: bigint('room_id', { mode: 'number' }),
		briefKey: text('brief_key').notNull(), // e.g. 'martol-core'

		version: integer('version').notNull(),
		status: text('status', {
			enum: ['draft', 'active', 'superseded', 'archived']
		}).notNull(),

		title: text('title').notNull(),
		summary: text('summary').notNull(),

		goal: jsonb('goal')
			.$type<{
				primaryOutcome?: string;
				currentPhase?: string;
				targetUsers?: string[];
				deliverableShape?: string[];
			}>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		nonGoals: jsonb('non_goals')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		constraints: jsonb('constraints')
			.$type<
				Array<{
					type: string;
					value: string;
					severity?: 'low' | 'medium' | 'high';
				}>
			>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		successCriteria: jsonb('success_criteria')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		currentScope: jsonb('current_scope')
			.$type<{
				inScope?: string[];
				outOfScope?: string[];
				deferred?: string[];
			}>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		architectureConstraints: jsonb('architecture_constraints')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		codingConventions: jsonb('coding_conventions')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		stakeholders: jsonb('stakeholders')
			.$type<
				Array<{
					role: string;
					label: string;
				}>
			>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		openQuestions: jsonb('open_questions')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		supersedesBriefId: bigint('supersedes_brief_id', { mode: 'number' }),

		createdByUserId: text('created_by_user_id'),
		createdByAgentId: text('created_by_agent_id'),
		promotionReason: text('promotion_reason'),
		confidence: numeric('confidence', { precision: 4, scale: 3 }),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		activatedAt: timestamp('activated_at', { withTimezone: true }),
		supersededAt: timestamp('superseded_at', { withTimezone: true })
	},
	(table) => ({
		briefVersionUnique: uniqueIndex('project_brief_org_room_key_version_uidx').on(
			table.orgId,
			table.roomId,
			table.briefKey,
			table.version
		),
		activeLookupIdx: index('project_brief_active_idx').on(
			table.orgId,
			table.roomId,
			table.briefKey,
			table.status,
			table.version
		)
	})
);

export const briefPatch = pgTable(
	'brief_patch',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: bigint('org_id', { mode: 'number' }).notNull(),
		roomId: bigint('room_id', { mode: 'number' }),
		briefKey: text('brief_key').notNull(),

		baseBriefId: bigint('base_brief_id', { mode: 'number' }).references(() => projectBrief.id),
		proposedBriefId: bigint('proposed_brief_id', { mode: 'number' }).references(() => projectBrief.id),

		status: text('status', {
			enum: ['proposed', 'accepted', 'rejected', 'withdrawn', 'superseded']
		}).notNull(),

		patchType: text('patch_type', {
			enum: [
				'goal_change',
				'scope_change',
				'non_goal_change',
				'constraint_change',
				'success_criteria_change',
				'architecture_change',
				'audience_change',
				'priority_change',
				'workflow_change',
				'phase_change',
				'deferment',
				'decision_reversal',
				'clarification',
				'merge'
			]
		}).notNull(),

		title: text('title').notNull(),
		rationale: text('rationale'),

		diff: jsonb('diff')
			.$type<{
				ops: Array<{
					op: 'add' | 'remove' | 'replace';
					path: string;
					old?: unknown;
					value?: unknown;
					new?: unknown;
				}>;
			}>()
			.notNull(),

		impactSummary: jsonb('impact_summary')
			.$type<{
				scope?: 'low' | 'medium' | 'high';
				affects?: string[];
				notes?: string[];
			}>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		conflictsWithActive: boolean('conflicts_with_active').notNull().default(false),
		confidence: numeric('confidence', { precision: 4, scale: 3 }),

		proposedByUserId: text('proposed_by_user_id'),
		proposedByAgentId: text('proposed_by_agent_id'),
		acceptedByUserId: text('accepted_by_user_id'),
		rejectedByUserId: text('rejected_by_user_id'),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true })
	},
	(table) => ({
		patchQueueIdx: index('brief_patch_queue_idx').on(
			table.orgId,
			table.roomId,
			table.briefKey,
			table.status,
			table.createdAt
		)
	})
);

export const briefDecision = pgTable(
	'brief_decision',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: bigint('org_id', { mode: 'number' }).notNull(),
		roomId: bigint('room_id', { mode: 'number' }),
		briefKey: text('brief_key').notNull(),

		briefId: bigint('brief_id', { mode: 'number' }).references(() => projectBrief.id),
		originatingPatchId: bigint('originating_patch_id', { mode: 'number' }).references(() => briefPatch.id),

		decisionType: text('decision_type', {
			enum: ['adopted', 'rejected', 'deferred', 'superseded', 'clarified']
		}).notNull(),

		title: text('title').notNull(),
		body: text('body').notNull(),
		rationale: text('rationale'),

		decisionPayload: jsonb('decision_payload')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		supersedesDecisionId: bigint('supersedes_decision_id', { mode: 'number' }).references(
			() => briefDecision.id
		),

		createdByUserId: text('created_by_user_id'),
		createdByAgentId: text('created_by_agent_id'),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(table) => ({
		decisionTimelineIdx: index('brief_decision_timeline_idx').on(
			table.orgId,
			table.roomId,
			table.briefKey,
			table.createdAt
		)
	})
);

export const briefSourceRef = pgTable(
	'brief_source_ref',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: bigint('org_id', { mode: 'number' }).notNull(),

		briefId: bigint('brief_id', { mode: 'number' }).references(() => projectBrief.id),
		patchId: bigint('patch_id', { mode: 'number' }).references(() => briefPatch.id),
		decisionId: bigint('decision_id', { mode: 'number' }).references(() => briefDecision.id),

		sourceKind: text('source_kind', {
			enum: ['message', 'action', 'system_event', 'file', 'external_doc']
		}).notNull(),

		sourceId: text('source_id').notNull(),
		excerpt: text('excerpt'),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(table) => ({
		sourceLookupIdx: index('brief_source_ref_lookup_idx').on(
			table.orgId,
			table.sourceKind,
			table.sourceId
		)
	})
);

export const taskBriefBinding = pgTable(
	'task_brief_binding',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: bigint('org_id', { mode: 'number' }).notNull(),
		roomId: bigint('room_id', { mode: 'number' }),

		taskId: text('task_id').notNull(),
		taskKind: text('task_kind', {
			enum: ['task', 'agent_run', 'action', 'review', 'handoff']
		}).notNull(),

		briefId: bigint('brief_id', { mode: 'number' })
			.notNull()
			.references(() => projectBrief.id),

		boundAt: timestamp('bound_at', { withTimezone: true }).defaultNow().notNull(),
		isLatest: boolean('is_latest').notNull().default(true)
	},
	(table) => ({
		taskBindingIdx: index('task_brief_binding_task_idx').on(
			table.orgId,
			table.taskId,
			table.isLatest
		)
	})
);

/**
 * Optional but useful:
 * one canonical active brief pointer per room/key to avoid "find latest active" scans.
 */
export const activeBriefPointer = pgTable(
	'active_brief_pointer',
	{
		orgId: bigint('org_id', { mode: 'number' }).notNull(),
		roomId: bigint('room_id', { mode: 'number' }),
		briefKey: text('brief_key').notNull(),
		briefId: bigint('brief_id', { mode: 'number' })
			.notNull()
			.references(() => projectBrief.id),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(table) => ({
		pk: uniqueIndex('active_brief_pointer_uidx').on(table.orgId, table.roomId, table.briefKey)
	})
);

export const projectBriefRelations = relations(projectBrief, ({ one, many }) => ({
	supersedes: one(projectBrief, {
		fields: [projectBrief.supersedesBriefId],
		references: [projectBrief.id]
	}),
	patches: many(briefPatch),
	decisions: many(briefDecision),
	sourceRefs: many(briefSourceRef),
	taskBindings: many(taskBriefBinding)
}));

export const briefPatchRelations = relations(briefPatch, ({ one, many }) => ({
	baseBrief: one(projectBrief, {
		fields: [briefPatch.baseBriefId],
		references: [projectBrief.id]
	}),
	proposedBrief: one(projectBrief, {
		fields: [briefPatch.proposedBriefId],
		references: [projectBrief.id]
	}),
	decisions: many(briefDecision),
	sourceRefs: many(briefSourceRef)
}));

export const briefDecisionRelations = relations(briefDecision, ({ one, many }) => ({
	brief: one(projectBrief, {
		fields: [briefDecision.briefId],
		references: [projectBrief.id]
	}),
	patch: one(briefPatch, {
		fields: [briefDecision.originatingPatchId],
		references: [briefPatch.id]
	}),
	supersedes: one(briefDecision, {
		fields: [briefDecision.supersedesDecisionId],
		references: [briefDecision.id]
	}),
	sourceRefs: many(briefSourceRef)
}));

export const briefSourceRefRelations = relations(briefSourceRef, ({ one }) => ({
	brief: one(projectBrief, {
		fields: [briefSourceRef.briefId],
		references: [projectBrief.id]
	}),
	patch: one(briefPatch, {
		fields: [briefSourceRef.patchId],
		references: [briefPatch.id]
	}),
	decision: one(briefDecision, {
		fields: [briefSourceRef.decisionId],
		references: [briefDecision.id]
	})
}));

export const taskBriefBindingRelations = relations(taskBriefBinding, ({ one }) => ({
	brief: one(projectBrief, {
		fields: [taskBriefBinding.briefId],
		references: [projectBrief.id]
	})
}));


⸻

Useful service-layer rules

These matter more than the tables:

1. Single active brief

Promote atomically:

await tx.transaction(async (trx) => {
	await trx
		.update(projectBrief)
		.set({
			status: 'superseded',
			supersededAt: new Date()
		})
		.where(
			and(
				eq(projectBrief.orgId, orgId),
				eq(projectBrief.roomId, roomId),
				eq(projectBrief.briefKey, briefKey),
				eq(projectBrief.status, 'active')
			)
		);

	const [nextBrief] = await trx
		.insert(projectBrief)
		.values({
			orgId,
			roomId,
			briefKey,
			version: nextVersion,
			status: 'active',
			title,
			summary,
			goal,
			currentScope,
			constraints,
			successCriteria,
			architectureConstraints,
			openQuestions,
			supersedesBriefId: oldActiveId,
			activatedAt: new Date(),
			createdByUserId: actorUserId,
			promotionReason
		})
		.returning({ id: projectBrief.id });

	await trx
		.insert(activeBriefPointer)
		.values({
			orgId,
			roomId,
			briefKey,
			briefId: nextBrief.id
		})
		.onConflictDoUpdate({
			target: [
				activeBriefPointer.orgId,
				activeBriefPointer.roomId,
				activeBriefPointer.briefKey
			],
			set: {
				briefId: nextBrief.id,
				updatedAt: new Date()
			}
		});
});

2. Never edit active brief in place

Only allow in-place edits for typo/admin metadata. Real direction changes must become:
	•	brief_patch
	•	then accepted/rejected
	•	then new project_brief version

3. Bind every agent run/task to a brief version

That solves the “50-message memory” problem at the control-plane level, not just in prompt stuffing.

⸻

Svelte UI wireframe spec

Martol already moved approvals inline into the main chat chronology, which is the right precedent here. The brief system should feel like a stateful companion to the timeline, not a disconnected admin screen.  ￼  ￼

UX principle

Use a 3-pane logic:
	•	Main chat/timeline
	•	Right-side Brief Drawer
	•	Inline brief system events inside timeline

That matches Martol’s merged timeline model for messages, system items, and actions.  ￼

⸻

Route / component layout

Route

src/routes/chat/[roomId]/+page.svelte

New components
	•	src/lib/components/brief/BriefDrawer.svelte
	•	src/lib/components/brief/ActiveBriefCard.svelte
	•	src/lib/components/brief/BriefPatchQueue.svelte
	•	src/lib/components/brief/BriefPatchCard.svelte
	•	src/lib/components/brief/BriefDecisionTimeline.svelte
	•	src/lib/components/brief/BriefDiffPreview.svelte
	•	src/lib/components/chat/BriefSystemLine.svelte

⸻

Wireframe 1 — chat page with brief drawer

┌──────────────────────────────────────────────────────────────────────────────┐
│ TopBar: #backend-api                    [Members] [Search] [Brief] [Settings]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LEFT / MAIN TIMELINE                           RIGHT DRAWER                 │
│                                                                              │
│  [message] Sarah: We should skip phase 1...     ┌─────────────────────────┐  │
│  [system] Proposed brief update detected        │ Active Brief            │  │
│  [brief patch card]                             │ v12 • active            │  │
│     Type: phase_change                          │ Title                   │  │
│     “Go straight to phase 3”                    │ martol-core             │  │
│     Conflict: yes                               │                         │  │
│     [Review]                                    │ Goal                    │  │
│                                                  │ - Multi-user AI collab │  │
│  [message] Azmi: ok put InsAIts later           │                         │  │
│  [system] Brief v13 activated                    │ In Scope                │  │
│                                                  │ - chat rooms            │  │
│  [action card] pending_action                    │ - MCP endpoint          │  │
│                                                  │ - approval queue        │  │
│  [message] agent: working on schema...          │                         │  │
│                                                  │ Deferred                │  │
│                                                  │ - InsAIts integration   │  │
│                                                  │                         │  │
│                                                  │ Constraints             │  │
│                                                  │ - server-enforced auth  │  │
│                                                  │ - no self-execution     │  │
│                                                  ├─────────────────────────┤  │
│                                                  │ Proposed Updates (3)    │  │
│                                                  │ [PatchCard]             │  │
│                                                  │ [PatchCard]             │  │
│                                                  │ [PatchCard]             │  │
│                                                  ├─────────────────────────┤  │
│                                                  │ Decisions               │  │
│                                                  │ - v13 adopted           │  │
│                                                  │ - D1 avoided            │  │
│                                                  │ - InsAIts deferred      │  │
│                                                  └─────────────────────────┘  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ChatInput                                                                    │
└──────────────────────────────────────────────────────────────────────────────┘


⸻

Wireframe 2 — Active Brief Card

Component

ActiveBriefCard.svelte

Purpose

Fast, pinned truth. This is what agents should inherit.

Props

type ActiveBriefCardProps = {
	brief: {
		id: number;
		briefKey: string;
		version: number;
		title: string;
		summary: string;
		goal: {
			primaryOutcome?: string;
			currentPhase?: string;
			targetUsers?: string[];
		};
		currentScope: {
			inScope?: string[];
			outOfScope?: string[];
			deferred?: string[];
		};
		constraints: Array<{ type: string; value: string; severity?: string }>;
		openQuestions: string[];
		status: 'active';
	};
	canEdit: boolean;
	onRefreshBrief?: () => void;
	onCreatePatch?: () => void;
};

Layout

┌─────────────────────────────────────┐
│ Active Brief          v13 • active  │
├─────────────────────────────────────┤
│ martol-core                         │
│ Multi-user AI collaboration         │
│ workspace with server authority     │
│                                     │
│ Phase                               │
│ Phase 3 direct                      │
│                                     │
│ In Scope                            │
│ • rooms / chat                      │
│ • MCP tools                         │
│ • approval queue                    │
│ • brief extraction                  │
│                                     │
│ Deferred                            │
│ • InsAIts integration               │
│                                     │
│ Constraints                         │
│ • server-derived sender             │
│ • no agent self-approval            │
│                                     │
│ Open Questions                      │
│ • WS push for approval status?      │
│                                     │
│ [Refresh summary] [Propose update]  │
└─────────────────────────────────────┘

Behavior
	•	collapsible sections
	•	copy-to-clipboard as markdown/json
	•	“Use in next agent task” badge when current task is bound to this version
	•	if stale against active pointer, show Outdated binding warning

⸻

Wireframe 3 — Proposed Updates queue

Component

BriefPatchQueue.svelte

Purpose

Review surface for directional changes extracted from discussion.

Props

type BriefPatchQueueProps = {
	patches: BriefPatchListItem[];
	canReview: boolean;
	actionsInFlight?: Set<number>;
	onApprove: (patchId: number) => void;
	onReject: (patchId: number) => void;
	onOpen: (patchId: number) => void;
};

Patch card layout

┌─────────────────────────────────────┐
│ phase_change              0.94 conf │
│ Go straight to Phase 3              │
│ conflict with active brief          │
│                                     │
│ Impact                              │
│ • roadmap                           │
│ • target user framing               │
│                                     │
│ Source                              │
│ msg #182, #183                      │
│                                     │
│ [View diff] [Approve] [Reject]      │
└─────────────────────────────────────┘

Rules
	•	sort: conflictsWithActive desc, then createdAt desc
	•	owners/leads can view, but only configured roles can approve high-impact patches
	•	show loading state to avoid double-submit, same lesson as action approval UI  ￼

⸻

Wireframe 4 — Diff preview modal/drawer

Component

BriefDiffPreview.svelte

Purpose

Make brief mutations reviewable, not vague.

Layout

┌──────────────────────────────────────────────────────────┐
│ Diff: active brief v12 → proposed patch #44             │
├──────────────────────────────────────────────────────────┤
│ REPLACE /goal/currentPhase                              │
│ - Phase 1 multi-agent dev tool                          │
│ + Phase 3 multi-user collaboration                      │
│                                                          │
│ ADD /currentScope/deferred/-                            │
│ + InsAIts integration                                   │
│                                                          │
│ REMOVE /currentScope/inScope/2                          │
│ - Python intermediary phase                             │
├──────────────────────────────────────────────────────────┤
│ Notes                                                    │
│ This patch conflicts with current phase plan.            │
│                                                          │
│ [Reject]                                [Approve patch]  │
└──────────────────────────────────────────────────────────┘

Interaction
	•	side-by-side for desktop
	•	stacked for mobile
	•	deep-link to message sources
	•	expandable raw JSON diff

⸻

Wireframe 5 — Decision timeline

Component

BriefDecisionTimeline.svelte

Purpose

Append-only history of accepted/rejected/deferred decisions.

Layout

┌─────────────────────────────────────┐
│ Decision Timeline                   │
├─────────────────────────────────────┤
│ Adopted • 2h ago                    │
│ Brief v13 activated                 │
│ “InsAIts moved to later enhancement”│
│ [view sources]                      │
│                                     │
│ Deferred • yesterday                │
│ Archival vector memory postponed    │
│                                     │
│ Superseded • 3d ago                 │
│ “Phase 1 Python intermediary”       │
│ superseded by v12                   │
└─────────────────────────────────────┘

Rules
	•	append-only feed
	•	color coding:
	•	adopted = positive
	•	rejected = muted/destructive
	•	deferred = amber
	•	superseded = neutral
	•	clicking a decision highlights related timeline messages

⸻

Wireframe 6 — inline system line in chat timeline

This is the important part.

Martol already treats actions as timeline items. Brief updates should work the same way.  ￼

Component

BriefSystemLine.svelte

Supported events
	•	brief_patch_proposed
	•	brief_patch_accepted
	•	brief_patch_rejected
	•	brief_version_activated
	•	task_bound_to_brief

Example cards

┌────────────────────────────────────────────────────┐
│ SYSTEM                                             │
│ Proposed brief update: “Defer InsAIts integration”│
│ Type: deferment • Confidence: 0.91                │
│ [Review patch]                                    │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ SYSTEM                                             │
│ Brief v13 activated                               │
│ Bound new agent tasks to v13                      │
│ [Open brief]                                      │
└────────────────────────────────────────────────────┘

Why inline

Because detached admin panels lose causality. You already fixed that for action approvals by moving them into the chat flow. Same logic applies here.  ￼

⸻

Suggested Svelte data contracts

Timeline union type

export type TimelineItem =
	| {
			kind: 'message';
			id: string;
			timestamp: string;
			message: DisplayMessage;
	  }
	| {
			kind: 'system';
			id: string;
			timestamp: string;
			event: SystemEvent;
	  }
	| {
			kind: 'action';
			id: string;
			timestamp: string;
			action: PendingAction;
	  }
	| {
			kind: 'brief';
			id: string;
			timestamp: string;
			briefEvent: BriefSystemEvent;
	  };

export type BriefSystemEvent =
	| {
			type: 'brief_patch_proposed';
			patchId: number;
			title: string;
			patchType: string;
			confidence?: number;
			conflictsWithActive: boolean;
	  }
	| {
			type: 'brief_patch_accepted';
			patchId: number;
			briefId: number;
			version: number;
			title: string;
	  }
	| {
			type: 'brief_patch_rejected';
			patchId: number;
			title: string;
	  }
	| {
			type: 'brief_version_activated';
			briefId: number;
			version: number;
			title: string;
	  }
	| {
			type: 'task_bound_to_brief';
			taskId: string;
			taskKind: 'task' | 'agent_run' | 'action' | 'review' | 'handoff';
			briefId: number;
			version: number;
	  };


⸻

Example BriefDrawer.svelte skeleton

<script lang="ts">
	import ActiveBriefCard from '$lib/components/brief/ActiveBriefCard.svelte';
	import BriefPatchQueue from '$lib/components/brief/BriefPatchQueue.svelte';
	import BriefDecisionTimeline from '$lib/components/brief/BriefDecisionTimeline.svelte';

	type Props = {
		open: boolean;
		activeBrief: ActiveBriefDto | null;
		proposedPatches: BriefPatchListItem[];
		recentDecisions: BriefDecisionListItem[];
		canReview: boolean;
		onApprovePatch: (id: number) => void;
		onRejectPatch: (id: number) => void;
		onOpenPatch: (id: number) => void;
		onRefreshBrief: () => void;
		onCreatePatch: () => void;
	};

	let {
		open,
		activeBrief,
		proposedPatches,
		recentDecisions,
		canReview,
		onApprovePatch,
		onRejectPatch,
		onOpenPatch,
		onRefreshBrief,
		onCreatePatch
	}: Props = $props();
</script>

{#if open}
	<aside class="brief-drawer">
		{#if activeBrief}
			<ActiveBriefCard
				brief={activeBrief}
				canEdit={canReview}
				onRefreshBrief={onRefreshBrief}
				onCreatePatch={onCreatePatch}
			/>
		{/if}

		<BriefPatchQueue
			patches={proposedPatches}
			canReview={canReview}
			onApprove={onApprovePatch}
			onReject={onRejectPatch}
			onOpen={onOpenPatch}
		/>

		<BriefDecisionTimeline decisions={recentDecisions} />
	</aside>
{/if}


⸻

API surface for UI

Read endpoints
	•	GET /api/briefs/active?briefKey=martol-core
	•	GET /api/briefs/patches?briefKey=martol-core&status=proposed
	•	GET /api/briefs/decisions?briefKey=martol-core&limit=20
	•	GET /api/briefs/patches/:id

Mutations
	•	POST /api/briefs/patches
	•	POST /api/briefs/patches/:id/approve
	•	POST /api/briefs/patches/:id/reject
	•	POST /api/briefs/refresh
	•	POST /api/briefs/bind-task

Important

When a patch is approved via REST, also emit a room event so all connected clients update consistently. Your current approval UI review already found split REST vs DO notification paths as a problem. Don’t repeat that here.  ￼

⸻

Recommended ship order
	1.	project_brief
	2.	brief_decision
	3.	active_brief_pointer
	4.	BriefDrawer.svelte
	5.	inline BriefSystemLine
	6.	brief_patch
	7.	diff modal
	8.	task binding

That gets you the control plane first, then the review flow.

Sources: Martol architecture and roadmap docs for Cloudflare/SvelteKit/Drizzle/Aiven shape, timeline-first chat model, inline approval pattern, and role-based review model.  ￼  ￼  ￼  ￼  ￼  ￼


