What is DAG of tasks?

You want to enable codex cli and claude code cli access as well as gh cli access and tooling for your agents that code. Separate agent roles. You want your thinking strong ai agent to take an input detailed description and break it down into a list of tasks but also in the form  of a structure DAG of task dependencies. You want to have ci and tests as part of pull requests and have another agent that’s a tester and responsible to merging PRs check for errors and issues and both to send back the tasks if things have bugs or tests fail.


---

A DAG of tasks is a Directed Acyclic Graph where:
	•	Node = a task
	•	Edge = “this task depends on that task”
	•	Directed = dependencies have direction
	•	Acyclic = no loops, so a task can’t eventually depend on itself

So instead of a flat todo list, you get an execution graph.

Example:
	•	Design DB schema
	•	Implement migrations
	•	Write integration tests
	•	Open PR
	•	Run CI
	•	Review + merge

Dependencies:
	•	Implement migrations depends on Design DB schema
	•	Write integration tests depends on Implement migrations
	•	Open PR depends on code + tests being ready
	•	Run CI depends on PR existing
	•	Review + merge depends on CI passing

That forms a DAG, not a linear checklist.

For what you described, the DAG is the right abstraction.

What your setup actually is

You’re describing a multi-agent software delivery pipeline with specialized roles:
	1.	Planner / thinking agent
	•	takes a detailed product or engineering request
	•	decomposes it into tasks
	•	outputs:
	•	a task list
	•	a DAG of dependencies
	•	task metadata like priority, risk, repo, owner-role, acceptance criteria
	2.	Coder agents
	•	separate roles for different tools / specialties
	•	e.g. claude-code:frontend, codex-cli:backend, gh-cli:release
	•	each works only on DAG nodes it is allowed to execute
	3.	Tester / reviewer agent
	•	validates implementation
	•	runs tests / lint / static checks / smoke checks
	•	reviews PR diffs
	•	either:
	•	approves progression
	•	or returns failed tasks back into the queue
	4.	Merge / gatekeeper agent
	•	never merges blindly
	•	merges only when CI passes, tests pass, policy checks pass, and no blocking issues remain

That matches the Martol direction of server-enforced authority, structured actions, and approval/gating instead of freeform agent execution. The product docs already lean in this direction with structured intents, pending actions, risk levels, role-based approval, MCP tools, and CI/testing as part of the roadmap.  ￼  ￼

The shape of the DAG

A useful task node schema would look like this:

{
  "id": "T12",
  "title": "Implement upload rate limiting",
  "type": "code",
  "repo": "martol",
  "area": "api/upload",
  "depends_on": ["T03", "T07"],
  "blocks": ["T15"],
  "agent_role": "codex-cli:backend",
  "risk": "medium",
  "acceptance_criteria": [
    "Per-user rate limit enforced",
    "Returns 429 on breach",
    "Test coverage added"
  ],
  "verification": [
    "unit_tests",
    "integration_tests",
    "lint"
  ],
  "pr_required": true,
  "merge_gate": "ci_green_and_tester_approved"
}

That gives you more than planning. It gives you orchestration.

Why DAG beats a normal task list

A flat list is bad for agent systems because it doesn’t answer:
	•	what can run in parallel
	•	what is blocked
	•	what must be re-run after failure
	•	what downstream tasks become invalid if upstream changes

A DAG gives you:
	•	parallelization
	•	frontend, backend, docs, tests can move simultaneously if independent
	•	replay
	•	if one node fails, rerun that subtree
	•	impact analysis
	•	failed migration task can automatically invalidate integration-test and merge tasks
	•	agent routing
	•	assign nodes by role/tool capability
	•	deterministic merge policy
	•	merge only when all ancestor + verification nodes are complete

A clean agent-role split

For your use case, I’d split like this:

1. Planner agent

Input: detailed feature brief
Output: DAG + task specs

Responsibilities:
	•	break request into atomic tasks
	•	infer dependencies
	•	tag risk
	•	assign suggested executor type
	•	define acceptance criteria
	•	define required verification nodes

2. Builder agents

Separate by tool / domain:
	•	claude-code:frontend
	•	codex-cli:backend
	•	claude-code:infra
	•	gh-cli:repo-ops

Responsibilities:
	•	claim executable unblocked nodes
	•	make branch
	•	implement
	•	open PR
	•	attach evidence

3. Tester agent

Responsibilities:
	•	run lint/tests/build
	•	inspect failures
	•	classify as:
	•	implementation bug
	•	flaky infra
	•	missing requirement
	•	bad test
	•	send failed node back with annotations

4. Reviewer / merger agent

Responsibilities:
	•	ensure PR linked to DAG node
	•	ensure CI green
	•	ensure required review checks green
	•	ensure no blocked/failing dependency
	•	merge or bounce back

5. Policy / authority layer

This should be server-side, not left to the LLM.

Needed checks:
	•	which agent can touch which repo/path
	•	who can open PR
	•	who can merge
	•	whether destructive actions require human approval
	•	whether a failed test automatically prevents merge

That part is aligned with the Martol principle that agents should not self-execute raw chat intent without server validation and action gating.  ￼  ￼

The key workflow

A good end-to-end loop is:

Stage 1: Plan

User gives a detailed request.

Planner agent outputs:
	•	epic summary
	•	tasks
	•	DAG
	•	execution phases
	•	PR boundaries

Stage 2: Execute

Unblocked nodes enter queue.

Builder agents:
	•	pick node
	•	implement in branch
	•	commit
	•	open PR

Stage 3: Verify

Tester agent:
	•	runs tests
	•	reviews output
	•	comments on PR
	•	marks node:
	•	passed
	•	failed
	•	needs-rework

Stage 4: Merge gate

Merger agent checks:
	•	all dependency nodes done
	•	CI passed
	•	required tests passed
	•	no unresolved review comments
	•	branch policy satisfied

Then merge.

Stage 5: Failure feedback

If test or review fails:
	•	PR stays open or is marked blocked
	•	originating node moves back to rework
	•	downstream nodes are paused
	•	planner may optionally regenerate sub-DAG if architecture changed

That “send tasks back if tests fail” is basically feedback edges in execution state, not literal edges in the DAG. Important distinction:
	•	the task graph should stay acyclic
	•	the workflow engine can loop task states: todo -> in_progress -> review -> failed -> rework -> review -> done

So:
	•	DAG = dependency model
	•	state machine = execution loop

That’s the correct design.

Important distinction: DAG is not the whole system

You actually need three layers:

1. Task DAG

Static dependency structure

2. Task state machine

Runtime state of each node

Example:
	•	queued
	•	ready
	•	in_progress
	•	in_pr
	•	ci_running
	•	failed
	•	rework
	•	done
	•	blocked

3. Policy engine

Enforcement

Example rules:
	•	only builder agents can move ready -> in_progress
	•	only tester agent can set ci_passed / ci_failed
	•	only merger agent can set merged
	•	merge blocked unless all required verification nodes are done

Without that third layer, your agents will cheat the workflow.

Best-practice DAG node types

Use different node classes.

Delivery nodes
	•	design
	•	code
	•	migration
	•	docs
	•	config

Verification nodes
	•	unit test
	•	integration test
	•	e2e test
	•	lint
	•	typecheck
	•	security scan

Governance nodes
	•	PR open
	•	review approve
	•	merge
	•	deploy approval

This matters because verification nodes should be first-class citizens, not afterthoughts.

For example:
	•	Implement auth middleware
	•	Write auth unit tests
	•	Run auth integration tests
	•	Open PR for auth middleware
	•	CI pass for auth PR
	•	Reviewer approve auth PR
	•	Merge auth PR

That is much cleaner than one giant “do auth feature” task.

Minimal DAG example for your setup

T1  Analyze feature request
T2  Produce architecture notes        depends on T1
T3  Break into implementation tasks   depends on T1
T4  Build backend changes             depends on T2, T3
T5  Build frontend changes            depends on T2, T3
T6  Write backend tests               depends on T4
T7  Write frontend tests              depends on T5
T8  Open backend PR                   depends on T4, T6
T9  Open frontend PR                  depends on T5, T7
T10 Run CI on backend PR              depends on T8
T11 Run CI on frontend PR             depends on T9
T12 Tester review backend PR          depends on T10
T13 Tester review frontend PR         depends on T11
T14 Merge backend PR                  depends on T12
T15 Merge frontend PR                 depends on T13

Parallelizable:
	•	T4 and T5
	•	T6 and T7
	•	T10 and T11

What I would add that you didn’t explicitly mention

Three things:

1. Task granularity rules

If tasks are too big, agents thrash.
If too small, orchestration overhead kills velocity.

Good rule:
	•	one node should usually map to one coherent PR
	•	unless the change is tiny enough to bundle safely

2. Capability-based routing

Don’t just route by role name.
Route by declared capabilities:

{
  "agent": "codex-cli:backend",
  "capabilities": [
    "edit_code",
    "run_tests",
    "open_pr",
    "comment_pr"
  ],
  "repos": ["martol"],
  "paths": ["src/routes/**", "src/lib/server/**"],
  "cannot": ["merge_main", "change_secrets"]
}

3. Failure classification

Tester agent should not only say “failed”.

It should classify:
	•	code_bug
	•	requirement_mismatch
	•	test_bug
	•	merge_conflict
	•	environment_failure
	•	flake

Otherwise your planner and coder agents can’t respond intelligently.

Practical architecture for this in Martol

Given your Martol docs, the natural fit is:
	•	Planner agent receives user brief in room
	•	It emits structured task DAG
	•	DAG stored in DB
	•	Builder agents interact through MCP tools / CLI bridges
	•	PRs are linked to task IDs
	•	Tester agent reads PR + CI results
	•	High-risk actions like merge remain gated
	•	Inline approval UI can show blocked actions / pending merges in timeline

That is very compatible with the existing architecture direction:
	•	real-time rooms
	•	role enforcement
	•	pending actions
	•	MCP endpoint
	•	approval UI
	•	auditable agent execution
	•	GitHub/CI in production roadmap.  ￼  ￼  ￼

In one sentence

A DAG of tasks is the dependency graph that tells your agents what can be done now, what must wait, what can run in parallel, and what must be re-verified before merge.

And for your case, the right model is:

planner creates DAG -> builders execute nodes -> tester validates PRs/CI -> merger gates completion -> failures send nodes back through a state machine, not by turning the DAG itself into a cycle.

Sources:  ￼  ￼  ￼

If you want, I can turn this into a concrete Martol spec: task schema, DAG schema, task states, and agent-role matrix.



---


I’d call the feature Agentic Delivery Graph.

That name is clean because it captures the two core ideas: agents do the work, and the work is modeled as a dependency graph rather than a flat todo list. If you want something more product-y for UI, use Delivery Graph in the product and keep agentic_delivery_graph as the internal spec name. It fits Martol’s existing positioning around multi-user agent collaboration, server-enforced authority, structured intents, and auditable execution.  ￼  ￼

Martol Spec: Agentic Delivery Graph

1. Feature summary

Agentic Delivery Graph lets a planning agent convert a detailed software request into:
	•	a task list
	•	a DAG of task dependencies
	•	execution assignments by agent role
	•	PR, CI, test, review, and merge gates

Builder agents execute only unblocked tasks they are authorized for. Tester/reviewer agents validate PRs and CI results. Failed work is sent back into rework without introducing cycles into the dependency graph. This extends Martol’s current action-gating model into full code-delivery orchestration.  ￼  ￼

2. Product goal

Turn Martol from “agents chatting about code” into “agents shipping code through a controlled delivery pipeline.”

3. Non-goals

Not a generic project-management board.
Not a freeform autonomous merge bot.
Not replacing GitHub Actions.
Not trusting the LLM to decide authority, mergeability, or policy on its own. Martol already treats server-side enforcement as the hard boundary, and this feature should preserve that.  ￼  ￼

4. User-facing concept

A room gets a new first-class object: Delivery Plan.

A Delivery Plan contains:
	•	request brief
	•	graph version
	•	task nodes
	•	dependency edges
	•	execution state per node
	•	linked branches / PRs / CI runs
	•	approval and merge events
	•	final outcome

Example user flow:
	1.	Owner/lead pastes a detailed feature request.
	2.	Planner agent produces a Delivery Plan.
	3.	Humans review and approve the plan.
	4.	Builder agents claim ready nodes.
	5.	Agents code through Codex CLI / Claude Code CLI / GH CLI wrappers.
	6.	Tester agent evaluates PRs and CI.
	7.	Merge agent merges only when policy passes.
	8.	Failed nodes go to rework; blocked descendants pause.

5. Core objects

5.1 delivery_plans

CREATE TABLE delivery_plans (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id),
  room_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES "user"(id),
  trigger_message_id BIGINT REFERENCES messages(id),
  status TEXT NOT NULL CHECK (status IN (
    'draft','active','paused','failed','completed','cancelled'
  )),
  graph_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

5.2 delivery_tasks

CREATE TABLE delivery_tasks (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES delivery_plans(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'analysis','design','code','test','review','ci','merge','deploy','docs'
  )),
  area TEXT,
  repo TEXT,
  base_branch TEXT,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  status TEXT NOT NULL CHECK (status IN (
    'draft','queued','ready','in_progress','in_pr','ci_running',
    'needs_review','failed','rework','blocked','done','cancelled'
  )),
  assigned_agent_binding_id BIGINT REFERENCES agent_room_bindings(id),
  requires_pr BOOLEAN NOT NULL DEFAULT TRUE,
  requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
  merge_gate BOOLEAN NOT NULL DEFAULT FALSE,
  acceptance_criteria_json JSONB,
  verification_requirements_json JSONB,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, task_key)
);

5.3 delivery_task_edges

CREATE TABLE delivery_task_edges (
  from_task_id BIGINT NOT NULL REFERENCES delivery_tasks(id) ON DELETE CASCADE,
  to_task_id BIGINT NOT NULL REFERENCES delivery_tasks(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL DEFAULT 'depends_on' CHECK (edge_type IN ('depends_on')),
  PRIMARY KEY (from_task_id, to_task_id),
  CHECK (from_task_id <> to_task_id)
);

5.4 delivery_runs

Tracks every execution attempt.

CREATE TABLE delivery_runs (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES delivery_tasks(id) ON DELETE CASCADE,
  attempt_no INT NOT NULL,
  started_by_agent_user_id TEXT REFERENCES "user"(id),
  status TEXT NOT NULL CHECK (status IN (
    'started','submitted_pr','ci_passed','ci_failed',
    'review_passed','review_failed','merged','aborted'
  )),
  branch_name TEXT,
  commit_sha TEXT,
  pr_number INT,
  pr_url TEXT,
  ci_provider TEXT,
  ci_run_url TEXT,
  summary TEXT,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

5.5 delivery_task_artifacts

CREATE TABLE delivery_task_artifacts (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES delivery_tasks(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN (
    'branch','commit','pr','ci_run','review','log','patch','report'
  )),
  external_id TEXT,
  url TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

6. DAG rules

Hard rules:
	•	graph must be acyclic
	•	task cannot depend on itself
	•	merge node cannot be ancestor of code node
	•	deploy nodes cannot unblock code/test nodes
	•	failed descendants do not rewrite graph topology; only task state changes
	•	rework is a state transition, not an edge

That last bit matters. The DAG stays acyclic; the workflow loops through state transitions.

7. Task schema

Canonical task JSON emitted by planner agent:

{
  "task_key": "BE-12",
  "title": "Implement GitHub webhook signature verification",
  "description": "Verify X-Hub-Signature-256 before processing PR status callbacks",
  "task_type": "code",
  "repo": "martol",
  "area": "src/routes/api/github/webhook",
  "base_branch": "main",
  "risk_level": "high",
  "depends_on": ["ARCH-02", "AUTH-03"],
  "suggested_agent_role": "codex-cli:backend",
  "acceptance_criteria": [
    "Reject invalid signatures with 401",
    "Supports SHA-256 HMAC validation",
    "Tests cover pass/fail cases"
  ],
  "verification_requirements": [
    "lint",
    "typecheck",
    "unit_tests"
  ],
  "requires_pr": true,
  "merge_gate": false
}

8. Agent roles

Recommended fixed roles:

planner

Breaks request into graph. No repo write. No merge.

builder

Implements ready code/doc/config tasks through tool bridges. Can open PRs. Cannot merge.

tester

Runs validation, interprets failures, comments on PRs, marks task pass/fail. Cannot merge code changes it authored.

reviewer

Reviews PR content and policy conformance. Can approve task state. No direct merge unless explicitly given merger capability.

merger

Performs merge only after all gates are green.

release

Optional later. Handles deploy nodes.

This fits Martol’s agent-room binding and org-scoped identities cleanly; agents are already room-scoped synthetic users with API keys and per-room bindings.  ￼  ￼

9. External tool bridges

For this feature, add tool adapters rather than baking CLIs into the core app.

codex_cli adapter

Capabilities:
	•	read repo
	•	create/edit files
	•	run local tests
	•	create commits
	•	produce patch logs

claude_code_cli adapter

Capabilities:
	•	same class as codex, but distinct binding and execution policy

gh_cli adapter

Capabilities:
	•	create branch
	•	push
	•	open PR
	•	comment on PR
	•	fetch PR diff/status
	•	merge PR if authorized

Each adapter should run behind a server-issued execution token tied to:
	•	org_id
	•	room_id
	•	plan_id
	•	task_id
	•	agent_user_id
	•	allowed commands
	•	repo/path scope
	•	expiry

Do not let agents invoke raw arbitrary shell with ambient authority.

10. Permission model

Extend current server-enforced action model instead of inventing a parallel one.

New action types:
	•	delivery_plan_create
	•	delivery_plan_activate
	•	delivery_task_execute
	•	delivery_task_reassign
	•	delivery_task_retry
	•	pull_request_open
	•	pull_request_review
	•	pull_request_merge

Suggested matrix:
	•	owner: all
	•	lead: create plans, activate plans, approve medium-risk execution, request retries, review PRs
	•	member: can request a plan, cannot activate or merge
	•	planner agent: submit plan only
	•	builder agent: execute assigned ready tasks only
	•	tester agent: update verification states only
	•	merger agent: merge only when server says mergeable

Same principle as existing Martol gating: server derives identity, role, and permission; never trust client or agent claims.  ￼  ￼

11. Workflow

11.1 Plan creation

User message:
“Build X. Use Codex for backend, Claude for frontend, add tests, open PRs, merge only after CI.”

Planner agent submits delivery_plan_create intent with:
	•	normalized objective
	•	tasks
	•	edges
	•	suggested agent mapping
	•	risk summary

Server validates DAG and stores as draft.

11.2 Plan approval

Owner/lead sees a graph preview in chat timeline and/or a Delivery tab.
On approval, status becomes active.

11.3 Task scheduling

Scheduler marks a node ready when all parents are done.

11.4 Task execution

Builder agent claims task.
Server creates execution token.
Agent uses Codex/Claude CLI bridge and may use GH CLI to open branch/PR.

11.5 PR verification

Tester agent watches PR and CI status.
If tests fail:
	•	task -> failed or rework
	•	descendants -> blocked
	•	run log attached
	•	agent/human notified in room

11.6 Merge gate

Merger agent can merge only if:
	•	task status = needs_review
	•	linked PR exists
	•	required CI checks passed
	•	no blocking review findings
	•	all ancestor tasks are done
	•	branch protection satisfied
	•	merge policy check passes

11.7 Rework loop

Retry increments attempt_no.
Graph stays the same unless planner emits a new graph version.

12. Task state machine

draft
  -> queued
  -> ready
  -> in_progress
  -> in_pr
  -> ci_running
  -> needs_review
  -> done

failure paths:
in_progress -> failed
in_pr -> failed
ci_running -> failed
needs_review -> rework
rework -> ready
any -> blocked
active states -> cancelled

Rule:
	•	blocked is derived from unresolved ancestors or plan pause
	•	rework means same task, new attempt
	•	graph version change creates new topology, not silent mutation

13. Failure classification

Tester agent must classify failures into a bounded enum:
	•	implementation_bug
	•	requirement_mismatch
	•	test_regression
	•	flaky_test
	•	merge_conflict
	•	ci_infra_failure
	•	policy_violation
	•	security_concern
	•	missing_dependency

This is key. “failed” alone is too weak for orchestration.

14. UI

14.1 Chat timeline

Keep delivery events inline with messages, same philosophy as current pending actions:
	•	plan created
	•	plan approved
	•	task ready
	•	PR opened
	•	CI passed/failed
	•	review requested
	•	merge completed

That is already consistent with Martol’s current timeline model where actions are first-class chronological items, not hidden side effects.  ￼

14.2 New Delivery tab

Per room:
	•	graph view
	•	list view
	•	by status
	•	by agent
	•	by repo
	•	by PR

Node card fields:
	•	title
	•	type
	•	status
	•	assigned agent
	•	repo/area
	•	PR link
	•	CI status
	•	latest failure
	•	acceptance criteria
	•	upstream/downstream links

14.3 PR panel

Shows:
	•	linked task
	•	branch
	•	commits
	•	checks
	•	review summary
	•	merge eligibility

15. API / MCP additions

Current MCP exposes chat and action tools only. Add delivery tools as a new family.  ￼

MCP tools
	•	delivery_plan_submit
	•	delivery_plan_get
	•	delivery_task_list
	•	delivery_task_claim
	•	delivery_task_update
	•	delivery_task_artifact_add
	•	delivery_task_fail
	•	delivery_task_complete
	•	delivery_merge_request

REST endpoints
	•	POST /api/delivery/plans
	•	GET /api/delivery/plans/:id
	•	POST /api/delivery/plans/:id/approve
	•	POST /api/delivery/plans/:id/pause
	•	POST /api/delivery/tasks/:id/retry
	•	POST /api/delivery/tasks/:id/reassign
	•	GET /api/delivery/tasks/:id/artifacts
	•	POST /api/delivery/tasks/:id/approve-merge

16. Example graph

P1  Analyze request
P2  Produce architecture notes          depends on P1
P3  Generate task graph                 depends on P1
B1  Implement backend                   depends on P2,P3
F1  Implement frontend                  depends on P2,P3
T1  Add backend tests                   depends on B1
T2  Add frontend tests                  depends on F1
PR1 Open backend PR                     depends on B1,T1
PR2 Open frontend PR                    depends on F1,T2
CI1 Backend CI                          depends on PR1
CI2 Frontend CI                         depends on PR2
RV1 Tester review backend               depends on CI1
RV2 Tester review frontend              depends on CI2
MG1 Merge backend PR                    depends on RV1
MG2 Merge frontend PR                   depends on RV2

17. What changes in Martol architecture

Minimal architectural delta:
	•	keep room/chat/action system as-is
	•	add delivery tables
	•	add scheduler in Worker / DO
	•	add tool-bridge service for CLIs
	•	add webhook ingestion for GitHub PR / CI status
	•	add delivery UI surfaces

This fits the existing stack:
	•	SvelteKit frontend
	•	/api/actions style approval patterns
	•	/mcp/v1 for agent tools
	•	Durable Object room coordination
	•	PostgreSQL for durable workflow state.  ￼  ￼

18. Security constraints

Non-negotiables:
	•	no self-approval
	•	builder cannot merge its own PR unless explicit policy says so
	•	merge writes must include org scoping in WHERE path
	•	every state transition append-logged
	•	webhook signatures verified
	•	CLI execution scoped by signed token
	•	path/repo restrictions enforced server-side
	•	plan edits create new graph version, not silent rewrites

Martol’s current approval review already surfaced self-approval and write-path hardening issues; this feature should inherit those lessons from day one.  ￼  ￼

19. Rollout

v1
	•	plan creation
	•	DAG storage + validation
	•	manual activation
	•	builder claims tasks
	•	PR linking
	•	CI status ingest
	•	tester pass/fail
	•	merge gate

v1.1
	•	auto-scheduler
	•	graph diffing / replan
	•	task templates
	•	flaky-test retry policy

v1.2
	•	deploy nodes
	•	cross-room repo coordination
	•	portfolio view across rooms

20. Naming recommendation

My pick:

Product/UI name: Delivery Graph
Internal spec/DB prefix: Agentic Delivery Graph
Slug: delivery_graph

Alternatives:
	•	Agent Pipeline — simpler, but weaker because it implies linear flow
	•	Execution Graph — technically strong, less product-friendly
	•	PR Graph — too GitHub-centric
	•	Ship Graph — catchy, but a bit too cute

Best balance is still Delivery Graph.


---



Below is a concrete v1 spec for Martol Delivery Graph.

I’d keep the naming as:
	•	UI/Product: Delivery Graph
	•	Internal/DB/MCP namespace: delivery_*

This fits Martol’s current model: multi-user rooms, agent MCP endpoint, inline action timeline, server-enforced authority, Drizzle + PostgreSQL, and room-scoped agent identities.  ￼  ￼  ￼

⸻

1) Exact Drizzle schema

Assumptions:
	•	existing project already has organization, user, messages, and likely agent_room_bindings-style membership/binding tables
	•	Martol is on PostgreSQL + Drizzle
	•	we want appendable auditability and server-side enforcement, not soft client logic  ￼  ￼

src/lib/server/db/schema/delivery.ts

import {
	pgTable,
	bigserial,
	bigint,
	text,
	integer,
	boolean,
	timestamp,
	jsonb,
	uniqueIndex,
	index,
	primaryKey,
	pgEnum
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Adjust these imports to your actual schema file names/exports
import { organization, user, messages } from './core';
import { agentRoomBindings } from './agents';

/* ----------------------------- Enums ----------------------------- */

export const deliveryPlanStatusEnum = pgEnum('delivery_plan_status', [
	'draft',
	'active',
	'paused',
	'failed',
	'completed',
	'cancelled'
]);

export const deliveryTaskTypeEnum = pgEnum('delivery_task_type', [
	'analysis',
	'design',
	'code',
	'test',
	'review',
	'ci',
	'merge',
	'deploy',
	'docs'
]);

export const deliveryRiskLevelEnum = pgEnum('delivery_risk_level', [
	'low',
	'medium',
	'high'
]);

export const deliveryTaskStatusEnum = pgEnum('delivery_task_status', [
	'draft',
	'queued',
	'ready',
	'in_progress',
	'in_pr',
	'ci_running',
	'needs_review',
	'failed',
	'rework',
	'blocked',
	'done',
	'cancelled'
]);

export const deliveryRunStatusEnum = pgEnum('delivery_run_status', [
	'started',
	'submitted_pr',
	'ci_passed',
	'ci_failed',
	'review_passed',
	'review_failed',
	'merged',
	'aborted'
]);

export const deliveryArtifactTypeEnum = pgEnum('delivery_artifact_type', [
	'branch',
	'commit',
	'pr',
	'ci_run',
	'review',
	'log',
	'patch',
	'report'
]);

export const deliveryFailureClassEnum = pgEnum('delivery_failure_class', [
	'implementation_bug',
	'requirement_mismatch',
	'test_regression',
	'flaky_test',
	'merge_conflict',
	'ci_infra_failure',
	'policy_violation',
	'security_concern',
	'missing_dependency'
]);

export const deliveryEventTypeEnum = pgEnum('delivery_event_type', [
	'plan_created',
	'plan_approved',
	'plan_paused',
	'plan_resumed',
	'plan_cancelled',
	'task_created',
	'task_ready',
	'task_claimed',
	'task_started',
	'task_updated',
	'task_failed',
	'task_reworked',
	'task_done',
	'pr_opened',
	'ci_started',
	'ci_passed',
	'ci_failed',
	'review_requested',
	'review_passed',
	'review_failed',
	'merge_requested',
	'merged',
	'artifact_added',
	'reassigned'
]);

/* ----------------------------- Tables ----------------------------- */

export const deliveryPlans = pgTable(
	'delivery_plans',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),

		roomId: text('room_id').notNull(),

		title: text('title').notNull(),
		description: text('description').notNull(),

		requestedByUserId: text('requested_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'restrict' }),

		triggerMessageId: bigint('trigger_message_id', { mode: 'number' }).references(
			() => messages.id,
			{ onDelete: 'set null' }
		),

		status: deliveryPlanStatusEnum('status').notNull().default('draft'),
		graphVersion: integer('graph_version').notNull().default(1),

		metadataJson: jsonb('metadata_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('delivery_plans_org_room_idx').on(table.orgId, table.roomId),
		index('delivery_plans_org_status_idx').on(table.orgId, table.status),
		index('delivery_plans_trigger_message_idx').on(table.triggerMessageId)
	]
);

export const deliveryTasks = pgTable(
	'delivery_tasks',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		planId: bigint('plan_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryPlans.id, { onDelete: 'cascade' }),

		taskKey: text('task_key').notNull(),
		title: text('title').notNull(),
		description: text('description'),

		taskType: deliveryTaskTypeEnum('task_type').notNull(),
		area: text('area'),
		repo: text('repo'),
		baseBranch: text('base_branch'),

		riskLevel: deliveryRiskLevelEnum('risk_level').notNull().default('low'),
		status: deliveryTaskStatusEnum('status').notNull().default('draft'),

		assignedAgentBindingId: bigint('assigned_agent_binding_id', {
			mode: 'number'
		}).references(() => agentRoomBindings.id, { onDelete: 'set null' }),

		requiresPr: boolean('requires_pr').notNull().default(true),
		requiresHumanApproval: boolean('requires_human_approval').notNull().default(false),
		mergeGate: boolean('merge_gate').notNull().default(false),

		acceptanceCriteriaJson: jsonb('acceptance_criteria_json')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		verificationRequirementsJson: jsonb('verification_requirements_json')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),

		metadataJson: jsonb('metadata_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('delivery_tasks_plan_task_key_uidx').on(table.planId, table.taskKey),
		index('delivery_tasks_plan_status_idx').on(table.planId, table.status),
		index('delivery_tasks_plan_type_idx').on(table.planId, table.taskType),
		index('delivery_tasks_assigned_agent_idx').on(table.assignedAgentBindingId),
		index('delivery_tasks_repo_area_idx').on(table.repo, table.area)
	]
);

export const deliveryTaskEdges = pgTable(
	'delivery_task_edges',
	{
		fromTaskId: bigint('from_task_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryTasks.id, { onDelete: 'cascade' }),
		toTaskId: bigint('to_task_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryTasks.id, { onDelete: 'cascade' }),
		edgeType: text('edge_type').notNull().default('depends_on')
	},
	(table) => [
		primaryKey({ columns: [table.fromTaskId, table.toTaskId], name: 'delivery_task_edges_pk' }),
		index('delivery_task_edges_to_idx').on(table.toTaskId),
		index('delivery_task_edges_from_idx').on(table.fromTaskId)
	]
);

export const deliveryRuns = pgTable(
	'delivery_runs',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		taskId: bigint('task_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryTasks.id, { onDelete: 'cascade' }),

		attemptNo: integer('attempt_no').notNull(),

		startedByAgentUserId: text('started_by_agent_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		status: deliveryRunStatusEnum('status').notNull(),
		branchName: text('branch_name'),
		commitSha: text('commit_sha'),
		prNumber: integer('pr_number'),
		prUrl: text('pr_url'),
		ciProvider: text('ci_provider'),
		ciRunUrl: text('ci_run_url'),

		summary: text('summary'),

		detailsJson: jsonb('details_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('delivery_runs_task_attempt_uidx').on(table.taskId, table.attemptNo),
		index('delivery_runs_task_created_idx').on(table.taskId, table.createdAt),
		index('delivery_runs_pr_idx').on(table.prNumber)
	]
);

export const deliveryTaskArtifacts = pgTable(
	'delivery_task_artifacts',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		taskId: bigint('task_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryTasks.id, { onDelete: 'cascade' }),

		artifactType: deliveryArtifactTypeEnum('artifact_type').notNull(),
		externalId: text('external_id'),
		url: text('url'),

		payloadJson: jsonb('payload_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('delivery_task_artifacts_task_idx').on(table.taskId, table.createdAt),
		index('delivery_task_artifacts_external_idx').on(table.externalId)
	]
);

export const deliveryTaskFailures = pgTable(
	'delivery_task_failures',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		taskId: bigint('task_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryTasks.id, { onDelete: 'cascade' }),

		runId: bigint('run_id', { mode: 'number' }).references(() => deliveryRuns.id, {
			onDelete: 'set null'
		}),

		classification: deliveryFailureClassEnum('classification').notNull(),
		summary: text('summary').notNull(),

		detailsJson: jsonb('details_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('delivery_task_failures_task_idx').on(table.taskId, table.createdAt),
		index('delivery_task_failures_run_idx').on(table.runId)
	]
);

export const deliveryEvents = pgTable(
	'delivery_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),

		roomId: text('room_id').notNull(),

		planId: bigint('plan_id', { mode: 'number' })
			.notNull()
			.references(() => deliveryPlans.id, { onDelete: 'cascade' }),

		taskId: bigint('task_id', { mode: 'number' }).references(() => deliveryTasks.id, {
			onDelete: 'cascade'
		}),

		runId: bigint('run_id', { mode: 'number' }).references(() => deliveryRuns.id, {
			onDelete: 'set null'
		}),

		eventType: deliveryEventTypeEnum('event_type').notNull(),

		actorUserId: text('actor_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		payloadJson: jsonb('payload_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('delivery_events_plan_created_idx').on(table.planId, table.createdAt),
		index('delivery_events_task_created_idx').on(table.taskId, table.createdAt),
		index('delivery_events_org_room_created_idx').on(table.orgId, table.roomId, table.createdAt)
	]
);

Notes you should enforce in app logic / SQL migrations

Drizzle won’t elegantly enforce all of these by itself, so add them in service layer or raw SQL migration:
	1.	Acyclic graph validation
	•	validate on plan create and plan version update.
	2.	No self-edge
	•	reject fromTaskId === toTaskId.
	3.	Cross-plan edge ban
	•	both tasks in an edge must belong to the same planId.
	4.	Org-scoped writes
	•	every update path should include orgId in the WHERE, same lesson as the approval-path review.  ￼  ￼
	5.	No self-approval / self-merge
	•	carry over the same hardening principle from pending actions.  ￼

⸻

2) MCP tool contracts

Martol already has a versioned authenticated MCP endpoint, so the clean move is to add a delivery_* family instead of inventing another agent surface.  ￼  ￼

Design rules
	•	tools are intent-level, not raw shell
	•	server validates org, room, role, and task state
	•	agents do not claim permissions in payload
	•	every write emits a delivery_events record
	•	builder/tester/merger roles map to separate agent users / bindings

Tool list

delivery_plan_submit

Planner submits a draft DAG.

Input

{
  "room_id": "room_backend",
  "title": "Webhook signature verification",
  "description": "Implement signed GitHub webhook verification and PR gating flow.",
  "trigger_message_id": 12345,
  "tasks": [
    {
      "task_key": "ARCH-01",
      "title": "Design webhook validation approach",
      "description": "Choose middleware location and error handling path.",
      "task_type": "design",
      "repo": "martol",
      "area": "src/routes/api/github",
      "base_branch": "main",
      "risk_level": "medium",
      "depends_on": [],
      "suggested_agent_role": "planner",
      "acceptance_criteria": [
        "Validation location is documented",
        "Failure response codes are defined"
      ],
      "verification_requirements": [],
      "requires_pr": false,
      "requires_human_approval": false,
      "merge_gate": false,
      "metadata": {}
    }
  ],
  "edges": [
    {
      "from_task_key": "ARCH-01",
      "to_task_key": "BE-01"
    }
  ],
  "metadata": {
    "planning_model": "gpt-5.4",
    "source": "chat_request"
  }
}

Output

{
  "plan_id": 81,
  "status": "draft",
  "graph_version": 1,
  "task_count": 7,
  "edge_count": 6
}

Server checks
	•	sender is planner-capable
	•	room membership valid
	•	DAG acyclic
	•	task keys unique
	•	no illegal task types / statuses

⸻

delivery_plan_get

Get a plan with tasks, edges, summary stats.

Input

{
  "plan_id": 81
}

Output

{
  "plan": {
    "id": 81,
    "status": "active",
    "graph_version": 1,
    "title": "Webhook signature verification"
  },
  "tasks": [],
  "edges": [],
  "stats": {
    "total": 7,
    "ready": 2,
    "blocked": 3,
    "done": 1,
    "failed": 1
  }
}


⸻

delivery_task_list

List tasks for a room/plan, optionally filtered.

Input

{
  "plan_id": 81,
  "status": ["ready", "rework"],
  "assigned_to_me": true
}

Output

{
  "tasks": [
    {
      "id": 301,
      "task_key": "BE-01",
      "title": "Implement signature verification",
      "status": "ready",
      "task_type": "code",
      "repo": "martol",
      "area": "src/routes/api/github/webhook",
      "risk_level": "high"
    }
  ]
}


⸻

delivery_task_claim

Builder/tester/merger claims a task.

Input

{
  "task_id": 301
}

Output

{
  "task_id": 301,
  "status": "in_progress",
  "attempt_no": 1,
  "execution_token": "signed-short-lived-token",
  "allowed_capabilities": [
    "repo.read",
    "repo.write",
    "tests.run",
    "pr.open"
  ]
}

Server checks
	•	task state must be ready or rework
	•	dependencies all done
	•	role matches allowed task type
	•	cannot claim if already actively claimed

⸻

delivery_task_update

General task progress checkpoint.

Input

{
  "task_id": 301,
  "status": "in_pr",
  "summary": "Implementation complete and PR opened.",
  "artifacts": [
    {
      "artifact_type": "branch",
      "external_id": "feature/webhook-signature",
      "url": null,
      "payload": {}
    },
    {
      "artifact_type": "pr",
      "external_id": "github:pr:442",
      "url": "https://github.com/org/repo/pull/442",
      "payload": {
        "pr_number": 442
      }
    }
  ]
}

Output

{
  "task_id": 301,
  "status": "in_pr",
  "run_id": 920
}

Allowed transitions
	•	in_progress -> in_pr
	•	in_pr -> ci_running
	•	ci_running -> needs_review

Server rejects illegal transitions.

⸻

delivery_task_fail

Tester/reviewer marks a task failed or rework-needed.

Input

{
  "task_id": 301,
  "status": "failed",
  "classification": "implementation_bug",
  "summary": "Webhook accepted invalid signature in negative test.",
  "details": {
    "failing_check": "unit_tests",
    "artifact_ref": "github:checkrun:9912"
  }
}

Output

{
  "task_id": 301,
  "status": "failed",
  "downstream_blocked_count": 2
}

Server effects
	•	create delivery_task_failures
	•	emit event
	•	mark descendants blocked if they were not terminal

⸻

delivery_task_complete

Mark task done.

Input

{
  "task_id": 301,
  "summary": "Merged successfully after green CI and reviewer approval."
}

Output

{
  "task_id": 301,
  "status": "done",
  "newly_ready_task_ids": [302, 303]
}


⸻

delivery_task_retry

Human or authorized tester/lead sends task from failed back to rework.

Input

{
  "task_id": 301,
  "reason": "Retry after patching signature compare logic."
}

Output

{
  "task_id": 301,
  "status": "rework",
  "attempt_no": 2
}


⸻

delivery_task_reassign

Move task to another agent binding.

Input

{
  "task_id": 301,
  "assigned_agent_binding_id": 99,
  "reason": "Backend task should move from generic builder to codex-backend."
}

Output

{
  "task_id": 301,
  "assigned_agent_binding_id": 99
}


⸻

delivery_merge_request

Merger asks server whether merge is permitted, then optionally executes.

Input

{
  "task_id": 301,
  "pr_number": 442,
  "execute": true
}

Output

{
  "task_id": 301,
  "mergeable": true,
  "checks": {
    "all_dependencies_done": true,
    "ci_green": true,
    "review_passed": true,
    "policy_ok": true
  },
  "status": "done"
}

Hard rule
	•	merge authority must remain server-gated, same philosophy as structured actions and approvals.  ￼  ￼

⸻

Suggested MCP schema shape

If you want consistency with current Martol MCP, use tool definitions like:

type DeliveryTaskClaimInput = {
	task_id: number;
};

type DeliveryTaskClaimOutput = {
	task_id: number;
	status: 'in_progress';
	attempt_no: number;
	execution_token: string;
	allowed_capabilities: string[];
};

And keep all tools:
	•	versioned under /mcp/v1
	•	auth via API key
	•	rate-limited
	•	org/room scoped by authenticated agent, not by trusting payload fields.  ￼  ￼

⸻

3) Task-status transition matrix

The DAG is static; the state machine loops. That distinction is the important bit.

Allowed statuses
	•	draft
	•	queued
	•	ready
	•	in_progress
	•	in_pr
	•	ci_running
	•	needs_review
	•	failed
	•	rework
	•	blocked
	•	done
	•	cancelled

Transition matrix

From	To	Who can do it	Conditions
draft	queued	server / planner finalizer	plan accepted into persisted graph
queued	ready	server scheduler	all ancestors done, not paused
queued	blocked	server	unresolved ancestor failure or plan pause
ready	in_progress	assigned builder/tester/reviewer/merger	task claimed successfully
ready	blocked	server	ancestor regressed / plan paused
in_progress	in_pr	builder	PR required and artifacts attached
in_progress	needs_review	builder/tester	no PR required and evidence attached
in_progress	failed	builder/tester/server	implementation failure / tool failure
in_progress	cancelled	owner/lead	plan/task cancelled
in_pr	ci_running	server/tester	CI started or detected
in_pr	failed	tester/server	PR invalid / policy violation / branch issue
ci_running	needs_review	server/tester	all required checks green
ci_running	failed	server/tester	any required check red
needs_review	done	reviewer/merger/server	approval satisfied, merge not required or merge completed
needs_review	rework	reviewer/tester	review failed but task remains same node
needs_review	failed	reviewer/tester/server	hard fail / policy issue
failed	rework	owner/lead/tester	retry approved
failed	cancelled	owner/lead	task abandoned
rework	ready	server	task reopened for new attempt
blocked	queued	server	blocking ancestor issue cleared
blocked	cancelled	owner/lead	abandoned
done	—	nobody	terminal
cancelled	—	nobody	terminal

Derived rules

Rule 1: blocked should usually be derived

Don’t let agents freely set blocked. Server sets it based on:
	•	failed ancestor
	•	paused plan
	•	cancelled upstream dependency

Rule 2: rework is same node, new run

Do not create a new task just because a retry happens. Increment attemptNo in delivery_runs.

Rule 3: only server marks downstream readiness

When a node becomes done, scheduler reevaluates descendants and moves them:
	•	blocked -> queued
	•	queued -> ready

Rule 4: terminal states
	•	done
	•	cancelled

Rule 5: no silent rewrites

If task topology changes, create new graph version on the plan rather than mutating dependency structure in place.

Extra validation rules

export function canTransition(from: DeliveryTaskStatus, to: DeliveryTaskStatus): boolean {
	const allowed: Record<DeliveryTaskStatus, DeliveryTaskStatus[]> = {
		draft: ['queued'],
		queued: ['ready', 'blocked'],
		ready: ['in_progress', 'blocked'],
		in_progress: ['in_pr', 'needs_review', 'failed', 'cancelled'],
		in_pr: ['ci_running', 'failed', 'cancelled'],
		ci_running: ['needs_review', 'failed', 'cancelled'],
		needs_review: ['done', 'rework', 'failed', 'cancelled'],
		failed: ['rework', 'cancelled'],
		rework: ['ready'],
		blocked: ['queued', 'cancelled'],
		done: [],
		cancelled: []
	};

	return allowed[from].includes(to);
}


⸻

4) Svelte UI wireframe spec

Martol already made the right move by rendering action approvals inline in the timeline instead of shoving them into a disconnected fixed panel. Delivery Graph should reuse that philosophy: timeline-native events plus a dedicated deep-work tab.  ￼  ￼

UX principle

Use two surfaces:
	1.	Chat timeline integration for awareness, audit, approvals, failures
	2.	Delivery tab for graph operations, filtering, and execution status

Do not force graph management into chat alone.

⸻

Route structure

Fits current route layout:

src/routes/chat/+page.svelte
src/routes/chat/DeliveryPanel.svelte
src/lib/components/delivery/
  DeliveryTab.svelte
  DeliveryGraph.svelte
  DeliveryTaskList.svelte
  DeliveryTaskDrawer.svelte
  DeliveryEventLine.svelte
  DeliveryPlanCard.svelte
  DeliveryFilterBar.svelte

Current app is already SvelteKit chat-first with inline timeline items and room-centric UI, so this is an additive fit rather than a redesign.  ￼  ￼

⸻

A. Chat timeline wireframe

New timeline item kind

Add delivery beside existing:
	•	message
	•	system
	•	action

Martol already merges multiple item kinds into one sorted timeline, so this is the natural extension.  ￼

DeliveryEventLine.svelte

Variants
	•	plan created
	•	plan approved
	•	task ready
	•	task claimed
	•	PR opened
	•	CI passed / failed
	•	review passed / failed
	•	merge completed
	•	task blocked
	•	task rework requested

Card layout

┌──────────────────────────────────────────────────────────────┐
│ Delivery Graph · Plan #81                                    │
│ Backend webhook signature verification                       │
│                                                              │
│ Event: CI failed on BE-01                                    │
│ Classification: implementation_bug                           │
│ Summary: invalid signature accepted in negative test         │
│                                                              │
│ [Open Task] [Open PR] [Retry Task]                           │
└──────────────────────────────────────────────────────────────┘

Behavior
	•	visible to all room members
	•	controls shown only if authorized
	•	no separate hidden “ops-only” stream
	•	chronological like action cards

That also fixes a trust issue Martol already discovered: hiding lifecycle from lower-privilege users makes the system look autonomous and magical in a bad way.  ￼

⸻

B. Delivery tab wireframe

Top-level layout

┌────────────────────────────────────────────────────────────────────────┐
│ Delivery Graph                                                        │
│ [Plan selector ▼] [New Plan] [Pause] [Replan] [List|Graph toggle]    │
├────────────────────────────────────────────────────────────────────────┤
│ Filters: [status ▼] [agent ▼] [repo ▼] [type ▼] [risk ▼] [search]    │
├───────────────────────────────┬────────────────────────────────────────┤
│ Left pane                     │ Main pane                              │
│                               │                                        │
│ Plan summary                  │ Graph view OR List view                │
│ - active / paused             │                                        │
│ - 14 tasks                    │                                        │
│ - 3 ready                     │                                        │
│ - 2 failed                    │                                        │
│ - 5 blocked                   │                                        │
│                               │                                        │
│ Mini legend                   │                                        │
│ - ready = blue                │                                        │
│ - failed = red                │                                        │
│ - blocked = gray              │                                        │
│ - done = green                │                                        │
│                               │                                        │
│ Recent events                 │                                        │
└───────────────────────────────┴────────────────────────────────────────┘


⸻

C. Graph view spec

DeliveryGraph.svelte

Use a DAG canvas or simple layered graph.
For v1, don’t get fancy. A left-to-right layered graph is enough.

Node visual design

Each node shows:
	•	task key
	•	title
	•	status badge
	•	type icon
	•	assigned agent
	•	PR/CI indicators

Example:

┌─────────────────────────────┐
│ BE-01   code      HIGH      │
│ Implement signature check   │
│ codex:backend               │
│ Status: ci_running          │
│ PR #442 · CI pending        │
└─────────────────────────────┘

Edge behavior
	•	straight or elbow lines
	•	hover highlights upstream/downstream
	•	click node opens right drawer

Color/status mapping
	•	ready = accent blue
	•	in_progress = cyan
	•	in_pr / ci_running = amber
	•	needs_review = violet
	•	failed = red
	•	rework = orange
	•	blocked = slate
	•	done = green
	•	cancelled = muted gray

Don’t rely on color alone; show badges too.

⸻

D. List view spec

DeliveryTaskList.svelte

Columns:
	•	Key
	•	Title
	•	Type
	•	Status
	•	Assigned
	•	Repo / Area
	•	Risk
	•	Latest artifact
	•	Updated at

Mobile fallback:
	•	stacked cards
	•	filters collapse into a drawer

Example row

BE-01 | Implement signature verification | code | failed | codex:backend
martol / src/routes/api/github/webhook | high | PR #442 | 3m ago

Actions per row

Conditional buttons:
	•	Claim
	•	Open
	•	Retry
	•	Approve
	•	Merge

⸻

E. Task drawer spec

DeliveryTaskDrawer.svelte

Opens from graph node or list row.

Sections:
	1.	header
	2.	status / ownership
	3.	acceptance criteria
	4.	dependency info
	5.	artifacts
	6.	run history
	7.	failure history
	8.	actions

Layout

┌───────────────────────────────────────────────┐
│ BE-01 · Implement signature verification      │
│ code · high · failed                          │
│ Assigned: codex:backend                       │
├───────────────────────────────────────────────┤
│ Acceptance criteria                           │
│ • Reject invalid signatures with 401          │
│ • Use HMAC SHA-256                            │
│ • Tests cover pass/fail                       │
├───────────────────────────────────────────────┤
│ Dependencies                                  │
│ Upstream: ARCH-01, AUTH-03                    │
│ Downstream: TEST-01, PR-01                    │
├───────────────────────────────────────────────┤
│ Artifacts                                     │
│ Branch: feature/webhook-signature             │
│ PR: #442                                      │
│ CI: GitHub Actions run #9912                  │
├───────────────────────────────────────────────┤
│ Latest failure                                │
│ implementation_bug                            │
│ invalid signature accepted in negative test   │
├───────────────────────────────────────────────┤
│ [Retry] [Reassign] [Open PR]                  │
└───────────────────────────────────────────────┘


⸻

F. Plan creation flow

Entry point

From chat composer or Delivery tab:
	•	“Create Delivery Plan”

Stepper modal

Step 1: request summary
Step 2: generated graph preview
Step 3: review task breakdown
Step 4: activate plan

Modal layout

[ Feature brief / pasted spec ]
--------------------------------
Generated tasks: 12
Dependencies: valid DAG
Parallelizable groups: 4

[Task preview list]
[Graph preview mini-map]

[Approve draft] [Cancel]

Since Martol already treats approvals and structured actions as first-class, plan activation should follow that pattern instead of silently materializing automation.  ￼  ￼

⸻

G. Store/state shape

Suggested client types

export type DeliveryPlan = {
	id: number;
	title: string;
	description: string;
	status: 'draft' | 'active' | 'paused' | 'failed' | 'completed' | 'cancelled';
	graphVersion: number;
	createdAt: string;
	updatedAt: string;
	stats: {
		total: number;
		ready: number;
		inProgress: number;
		blocked: number;
		failed: number;
		done: number;
	};
};

export type DeliveryTask = {
	id: number;
	planId: number;
	taskKey: string;
	title: string;
	description: string | null;
	taskType: string;
	status: string;
	riskLevel: string;
	repo: string | null;
	area: string | null;
	baseBranch: string | null;
	assignedAgentBindingId: number | null;
	acceptanceCriteria: string[];
	verificationRequirements: string[];
	metadata: Record<string, unknown>;
};

export type DeliveryEdge = {
	fromTaskId: number;
	toTaskId: number;
};

export type DeliveryEvent = {
	id: number;
	planId: number;
	taskId: number | null;
	runId: number | null;
	eventType: string;
	payload: Record<string, unknown>;
	createdAt: string;
};

Store shape

type DeliveryState = {
	activePlanId: number | null;
	plans: DeliveryPlan[];
	tasksByPlan: Record<number, DeliveryTask[]>;
	edgesByPlan: Record<number, DeliveryEdge[]>;
	eventsByPlan: Record<number, DeliveryEvent[]>;
	filters: {
		status: string[];
		agent: string | null;
		repo: string | null;
		type: string[];
		risk: string[];
		search: string;
	};
	selectedTaskId: number | null;
	viewMode: 'graph' | 'list';
};


⸻

H. Component contract sketch

DeliveryTab.svelte

<script lang="ts">
	export let plans: DeliveryPlan[] = [];
	export let activePlan: DeliveryPlan | null = null;
	export let tasks: DeliveryTask[] = [];
	export let edges: DeliveryEdge[] = [];
	export let events: DeliveryEvent[] = [];
	export let canManagePlans = false;
	export let canRetryTasks = false;
	export let canMerge = false;
</script>

DeliveryGraph.svelte

<script lang="ts">
	export let tasks: DeliveryTask[] = [];
	export let edges: DeliveryEdge[] = [];
	export let selectedTaskId: number | null = null;

	export let onSelectTask: (taskId: number) => void;
</script>

DeliveryTaskDrawer.svelte

<script lang="ts">
	export let task: DeliveryTask | null = null;
	export let upstream: DeliveryTask[] = [];
	export let downstream: DeliveryTask[] = [];
	export let artifacts: any[] = [];
	export let failures: any[] = [];
	export let canRetry = false;
	export let canReassign = false;
	export let canMerge = false;

	export let onRetry: (taskId: number) => void;
	export let onReassign: (taskId: number) => void;
	export let onMerge: (taskId: number) => void;
</script>


⸻

I. Timeline integration contract

Martol already merges timeline items by timestamp, so just extend the union type.

type TimelineItem =
	| { kind: 'message'; timestamp: string; key: string; data: DisplayMessage }
	| { kind: 'system'; timestamp: string; key: string; data: SystemEvent }
	| { kind: 'action'; timestamp: string; key: string; data: PendingAction }
	| { kind: 'delivery'; timestamp: string; key: string; data: DeliveryEvent };

And in MessageList.svelte:

{#each timeline as item (item.key)}
	{#if item.kind === 'message'}
		<MessageBubble ... />
	{:else if item.kind === 'system'}
		<SystemEventLine ... />
	{:else if item.kind === 'action'}
		<PendingActionLine ... />
	{:else if item.kind === 'delivery'}
		<DeliveryEventLine ... />
	{/if}
{/each}

That keeps the mental model consistent with the existing inline action timeline design.  ￼

⸻

J. Authorization UI matrix

Role	View plans	View tasks	Activate plan	Claim task	Retry task	Merge
Owner	Yes	Yes	Yes	Yes	Yes	Yes
Lead	Yes	Yes	Yes	limited	Yes	policy-based
Member	Yes	Yes	No	No	No	No
Viewer	Yes	Yes	No	No	No	No
Planner agent	scoped	scoped	No	No	No	No
Builder agent	scoped	scoped	No	Yes	No	No
Tester agent	scoped	scoped	No	task-type only	Yes	No
Merger agent	scoped	scoped	No	merge nodes only	No	Yes

This follows the same access-control posture as Martol’s room/action model: authority is role-derived and enforced server-side, not inferred from client intent.  ￼

⸻

K. v1 wireframe decisions I strongly recommend
	1.	Do not put graph editing directly in the chat composer.
Use a modal or Delivery tab.
	2.	Do not let agents create arbitrary new tasks post-activation.
They can propose replan, but human/server approves graph version bump.
	3.	Do not hide failed nodes.
Failed and blocked are the whole point of the graph.
	4.	Do not use optimistic UI for merge-complete state unless server confirms.
Approval UI already showed where optimistic updates can drift.  ￼
	5.	Do not split approval paths.
One canonical path for task approval/retry/merge events, otherwise you recreate the REST-vs-DO inconsistency problem already identified in action approvals.  ￼

⸻

Recommended next build order
	1.	Drizzle schema + migration
	2.	server state-transition service
	3.	MCP delivery_* tools
	4.	timeline delivery item support
	5.	Delivery tab with list view first
	6.	graph canvas second
	7.	GitHub webhook + CI ingest
	8.	merge gate

That sequencing matches Martol’s current architecture: stable MCP endpoint, chat timeline as first-class event surface, and PostgreSQL-backed durable state.  ￼  ￼

Next step should be turning this into actual code files:
	•	delivery.ts Drizzle schema
	•	delivery-service.ts
	•	MCP tool zod schemas
	•	DeliveryTab.svelte skeleton
	•	DeliveryEventLine.svelte skeleton


---

## Review notes (2026-03-06)

**Verdict: KIV — build after v1 is solid.**

The design is sound. The three-layer model (DAG topology + state machine + policy engine), the role split, failure classification, and execution tokens are all well-thought-out. It aligns with Martol's core principles: server-enforced authority, structured intents, action gating.

However, building this now would be premature. Prerequisites that don't exist yet:

1. **No GitHub integration.** The DAG assumes PR creation, CI status webhooks, merge operations. None of that infrastructure exists — that alone is a multi-week effort (webhook endpoints, OAuth app, status sync).
2. **No CI pipeline integration.** The tester agent concept requires CI results to flow back into Martol (GitHub Actions webhooks, status check polling, or a CI adapter layer).
3. **Agent tooling is still basic.** Currently agents have `action_submit` and `action_status`. The DAG needs ~9 new MCP tools plus the execution token system.
4. **Agent client just stabilized.** The pip-installable wrapper, reconnection logic, and error handling were literally fixed the same week as this review. Needs time to prove stability before orchestrating multi-agent delivery pipelines.
5. **No multi-agent coordination tested at scale.** Current usage is 1-2 agents per room. The DAG assumes 4-5 specialized agents claiming tasks, handing off, and coordinating.

### Recommended path to get there

1. Stabilize v1: rooms, chat, actions, single-agent workflows
2. Add GitHub OAuth + webhook basics (prerequisite for DAG)
3. Add a simple flat task list to rooms — gives UI patterns and DB schema foundations
4. Once agents can reliably open PRs and check CI, layer the DAG orchestration on top

Keep this spec as the north star for v2.
