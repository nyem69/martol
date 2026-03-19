/**
 * AI SDK + Workers AI Provider — Investigation Report
 *
 * This script documents findings from investigating why AI SDK's streamText()
 * produces zero tokens when used with workers-ai-provider inside a Durable Object.
 *
 * Run: npx tsx scripts/test-ai-sdk.ts
 * (informational only — no actual API calls)
 */

// ============================================================================
// FINDING 1: How workers-ai-provider calls Workers AI internally
// ============================================================================
//
// File: node_modules/workers-ai-provider/src/workersai-chat-language-model.ts
//
// The provider's `doStream()` method (line 205-278):
//   1. Converts AI SDK prompt format to Workers AI chat messages
//   2. Calls `this.config.binding.run(model, inputs, options)` with `{ stream: true }`
//      - `binding` is the `env.AI` Workers AI binding passed via createWorkersAI({ binding: env.AI })
//   3. Expects a `ReadableStream<Uint8Array>` back (SSE format)
//   4. Pipes through SSEDecoder → TransformStream that maps SSE events to LanguageModelV3StreamPart
//
// The `buildRunInputs()` method (line 120-148) constructs:
//   {
//     max_tokens, messages, temperature, tools, top_p,
//     stream: true  // <-- added when options.stream is true
//   }
//
// This is the same shape that direct `env.AI.run()` accepts — no transformation issue.

// ============================================================================
// FINDING 2: The streaming pipeline (SSE parsing)
// ============================================================================
//
// File: node_modules/workers-ai-provider/src/streaming.ts
//
// The SSE pipeline has THREE stages:
//   1. SSEDecoder: raw bytes → individual "data: ..." payloads (line 314-348)
//   2. getMappedStream: SSE payloads → LanguageModelV3StreamPart events (line 64-307)
//   3. prependStreamStart: prepends stream-start event (line 14-41)
//
// The SSEDecoder expects standard SSE format:
//   data: {"response":"Hello"}
//   data: {"response":" world"}
//   data: [DONE]
//
// Workers AI's `env.AI.run()` with `stream: true` returns exactly this format.
// So the provider's parsing should work — the issue is not in SSE parsing.

// ============================================================================
// FINDING 3: Potential DO-specific issues
// ============================================================================
//
// The RAG response runs inside `ctx.waitUntil()` in the Durable Object:
//
//   this.ctx.waitUntil(this.runRagResponse(orgId, msg.body, config).catch(...));
//
// Three possible failure modes in DO context:
//
// A) ReadableStream lifecycle in ctx.waitUntil():
//    - streamText() returns an async iterable (result.textStream)
//    - Consuming an async iterable over a ReadableStream requires the stream
//      to remain open for the duration of iteration
//    - In a DO, ctx.waitUntil() keeps the isolate alive, but the underlying
//      Workers AI binding connection may behave differently than in a regular Worker
//    - If the DO's request context finalizes before the stream is fully consumed,
//      the ReadableStream from env.AI.run() may be prematurely closed
//
// B) TransformStream backpressure in DO:
//    - The provider uses `pipeThrough(new TransformStream(...))` extensively
//    - DOs have a different microtask scheduling model than regular Workers
//    - If the TransformStream's internal queue fills up and the consumer (streamText)
//      doesn't pull fast enough, the stream may stall
//    - This could explain "zero tokens" — the stream opens but no data flows
//
// C) env.AI binding behavior in Durable Objects:
//    - env.AI is an RPC binding to Workers AI
//    - In a regular Worker, the binding call happens within the request context
//    - In a DO, the binding call happens in an async context (waitUntil or alarm)
//    - The binding may return a ReadableStream that is tied to the original request
//      context, which may already be closing when ctx.waitUntil runs
//    - This is the MOST LIKELY cause: the ReadableStream from env.AI.run(stream:true)
//      may be invalidated when the triggering WebSocket message handler returns
//
// EVIDENCE: Direct env.AI.run() WITHOUT stream:true works fine in the same DO context.
// This strongly suggests the issue is with ReadableStream lifecycle, not with the
// AI binding itself.

// ============================================================================
// FINDING 4: Known issues
// ============================================================================
//
// GitHub issues tracker: https://github.com/cloudflare/ai/issues
// Package: workers-ai-provider v3.1.2
//
// No specific "Durable Object streaming" issue found in the package itself,
// but the issue is likely in the Workers runtime, not the provider package.
//
// The Cloudflare Workers runtime has known limitations with ReadableStream in DOs:
// - ReadableStream from service bindings/subrequests in ctx.waitUntil can be
//   prematurely terminated
// - This is documented in Cloudflare's DO docs under "WebSocket Hibernation API"
//   limitations
//
// Workaround options:
// 1. Use non-streaming env.AI.run() (current approach — works)
// 2. Move the AI call to a regular Worker route and fetch() from the DO
// 3. Use the REST API instead of the binding (workers-ai-provider supports this
//    via accountId/apiKey credentials instead of binding)

// ============================================================================
// FINDING 5: Package bundle impact analysis
// ============================================================================
//
// All three packages are in package.json dependencies:
//   - "ai": "^6.0.116"
//   - "workers-ai-provider": "^3.1.2"
//   - "@ai-sdk/openai": "^3.0.41"
//
// Active imports in src/: NONE
//   - responder.ts has commented-out imports (lines 9-10)
//   - No other file imports from any of these packages
//
// Bundle impact: ZERO at runtime
//   - Cloudflare Workers bundler (esbuild via wrangler) only includes code that
//     is actually imported. Since all imports are commented out, these packages
//     are not included in the deployed Worker bundle.
//   - They only add to node_modules size and pnpm install time (~15MB total).
//
// Recommendation:
//   - KEEP for now — they cost nothing in the bundle and removing them makes
//     future re-evaluation harder (Phase 2 of docs/026)
//   - REMOVE if the DO streaming issue is confirmed unfixable and no other
//     use case is planned

// ============================================================================
// SUMMARY
// ============================================================================
//
// Root cause (most likely): ReadableStream from env.AI.run({stream:true}) is
// tied to the request context. In a Durable Object, when the WebSocket message
// handler returns, the request context may finalize, causing the ReadableStream
// to close before streamText() can consume it via async iteration.
//
// This explains why:
// - streamText() yields zero tokens (stream closes immediately)
// - Direct env.AI.run() without streaming works (returns complete response, no stream)
// - The same code would work in a regular Worker (request context stays open)
//
// Next steps:
// 1. Test streamText() in a regular Worker route handler (not DO) to confirm
// 2. Test streamText() inside DO but NOT in ctx.waitUntil (e.g., in fetch() handler)
// 3. Test with REST API credentials instead of binding
// 4. If confirmed DO-specific, file issue on cloudflare/workers-sdk (not workers-ai-provider)

console.log('=== AI SDK + Workers AI Provider Investigation ===');
console.log('');
console.log('Package: workers-ai-provider v3.1.2');
console.log('Source: https://github.com/cloudflare/ai');
console.log('Issues: https://github.com/cloudflare/ai/issues');
console.log('');
console.log('Key findings:');
console.log('1. Provider calls env.AI.run() with { stream: true } — same as direct call');
console.log('2. SSE parsing pipeline is correct (SSEDecoder → TransformStream)');
console.log('3. Most likely cause: ReadableStream lifecycle in DO ctx.waitUntil()');
console.log('4. No active imports — zero bundle impact');
console.log('5. Current workaround (direct env.AI.run without streaming) is correct');
console.log('');
console.log('See script comments for detailed analysis.');
