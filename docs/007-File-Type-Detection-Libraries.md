# File Type Detection Libraries

**Date:** 2026-03-04
**Status:** Evaluated — not adopted (revisit when expanding allowed upload types)

## Context

Martol's upload endpoint (`POST /api/upload`) validates files against 6 allowed content types using a hand-rolled 25-line `validateMagicBytes` function. We evaluated two libraries for potential replacement.

**Current allowed types:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`

**Current validation:** 3-12 byte magic signature checks per binary type, regex scan for `text/plain` (HTML injection markers). Zero dependencies.

---

## Google Magika

**Repo:** https://github.com/google/magika
**npm:** `magika@1.0.0`
**License:** Apache-2.0

AI-powered file type detection using deep learning. Identifies 200+ content types with ~99% accuracy, trained on ~100M files. Core rebuilt in Rust for v1.0 (Nov 2025), uses ONNX Runtime for inference.

### JS implementation

- Depends on `@tensorflow/tfjs` (~20MB+ unpacked)
- Requires async model loading: `await Magika.create()`
- Separate imports: `magika` (browser), `magika/node` (Node.js)
- Rust core uses ONNX Runtime, but JS binding still uses TensorFlow.js — no edge-compatible binding exists

### Pros

| Pro | Detail |
|-----|--------|
| Highest accuracy | 99% on 200+ types via ML model, far beyond magic bytes |
| Content-aware | Analyzes full file content, not just headers — catches sophisticated spoofing |
| Solves text/plain | Would properly classify HTML-disguised-as-text without regex hacks |
| Google-maintained | Active development, used internally at Google |

### Cons

| Con | Detail |
|-----|--------|
| **TensorFlow.js dependency** | ~20MB+ — exceeds Cloudflare Workers 10MB paid limit. **Won't deploy.** |
| Model loading latency | Must fetch and initialize ML model per cold start |
| Overkill | 1MB ML model to gate 6 known formats |
| No edge runtime support | Not tested on Cloudflare Workers; TF.js uses many Node APIs that may not be shimmed |

### Verdict

**Blocked by bundle size.** TensorFlow.js cannot fit in a Cloudflare Worker. Revisit if/when the JS binding migrates from TensorFlow.js to ONNX Runtime Web or Rust-WASM — tracked at https://github.com/google/magika/issues/173.

---

## sindresorhus/file-type

**Repo:** https://github.com/sindresorhus/file-type
**npm:** `file-type@21.3.0`
**License:** MIT

Pure JavaScript magic-bytes detection for 190+ file types. Battle-tested (~50M weekly downloads), maintained for 10+ years.

### JS implementation

- 4 dependencies: `strtok3`, `token-types`, `uint8array-extras`, `@tokenizer/inflate`
- ESM-only, requires Node >= 20
- Cloudflare Workers: works via `import { fileTypeFromBuffer } from 'file-type/core'` (community workaround, not officially supported — https://github.com/sindresorhus/file-type/issues/595)
- Returns `{ ext, mime }` or `undefined` (for unrecognized/text files)

### Pros

| Pro | Detail |
|-----|--------|
| Thorough signatures | Deeper byte pattern checks per format than our 3-4 byte comparisons |
| Cross-check capability | Detect actual type, compare against claimed type — catches spoofing |
| Battle-tested | 50M+ weekly downloads, mature ecosystem package |
| Workers-compatible | `/core` import avoids Node stream APIs |

### Cons

| Con | Detail |
|-----|--------|
| **Doesn't detect text/plain** | Returns `undefined` for text files — our regex scanner is still needed for the trickiest case |
| 4 transitive dependencies | Adds supply chain surface for marginal benefit at 6 types |
| 190+ types, we use 6 | < 3% utilization — bulk of the code is dead weight |
| Unofficial Workers support | `/core` workaround could break in future versions |
| ESM-only, breaking major bumps | Sindresorhus packages change APIs between majors — version pinning required |

### Verdict

**Not justified at 6 types.** Our 25-line function covers all allowed types with zero dependencies. `file-type` doesn't help with `text/plain` (our hardest case). Revisit when allowed types expand beyond ~15.

---

## When to Revisit

Adopt a library when **any** of these conditions are met:

| Trigger | Recommended action |
|---------|--------------------|
| Allowed types expand to 15+ | Adopt `file-type` via `/core` import |
| Video/audio uploads added | Adopt `file-type` — media container formats have complex signatures |
| Magika JS moves to ONNX/WASM | Re-evaluate Magika — would solve text detection and polyglot files |
| Content-type spoofing incident | Adopt `file-type` as cross-check layer alongside existing validation |

---

## References

- [Google Magika GitHub](https://github.com/google/magika)
- [Magika 1.0 announcement](https://opensource.googleblog.com/2025/11/announcing-magika-10-now-faster-smarter.html)
- [Magika ONNX Web issue](https://github.com/google/magika/issues/173)
- [file-type GitHub](https://github.com/sindresorhus/file-type)
- [file-type Cloudflare Workers issue](https://github.com/sindresorhus/file-type/issues/595)
- [Cloudflare Workers size limits](https://developers.cloudflare.com/workers/platform/limits/)
