# Hardening review: "perfect for millions" checklist vs the Saydo code

Date: 2026-10-18. The pasted analysis assumed nothing was built ("we're in plan mode and the workspace is empty"). That was outdated: Saydo exists, so every item below was checked against the real code and tests.

**Legend:**
- ✅ already built before this review
- 🔧 fixed in this review
- 🗺 roadmap (the reason is given)
- ✳ by design, or the item does not apply

Test counts refer to `pnpm test` (114 passing).

## Corrections to the analysis

| Claim | Finding |
|---|---|
| "Nothing is built" | Outdated. Both templates install from packed tarballs, build and serve; 114 tests pass. |
| "MCP elicitation can't serve approval; it's for input, not authorization" | **Wrong for URL mode.** The 2025-11-25 spec's URL-mode elicitation exists for out-of-band sensitive interactions that must not pass through the client, naming auth flows and payments ([spec](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)). It is a viable standard transport for delegated approval: send the user to the app's own approval page. |
| "WAREX: >70% success drop under network faults" | WAREX is real (Stanford + Microsoft Research, TMLR 2026, [arXiv 2510.03285](https://arxiv.org/abs/2510.03285v1)) and reports significant drops. The exact ">70%" figure was not verified. |
| "Use a latest-ref, explicitly not useEffectEvent" | Calling an Effect Event from a callback set up inside an Effect is React's documented pattern, and it worked in our React 19.3 tests. We switched to a latest-ref anyway (🔧 `useLatest`): it works on React 19.0+ and ends the debate. |
| "Tainted turns must never drop below confirm tier" | Saydo already requires a confirmation for **every** irreversible step in **every** turn, which is stricter than taint-conditional gating. Escalating read and reversible steps in tainted turns would gate nearly every turn, because the screen is always present. That is the confirm fatigue the same analysis calls a security failure. Kept instead: untrusted markers, non-operable `data-saydo-untrusted` regions, and 🔧 `act.annotationsCanLowerRisk: false` for apps that render rich user HTML. |
| "Handles must be random" | Handles are per-thread entries in HMAC-signed state, so a handle from another thread does not resolve, and every use is re-authorized through `entity.get`. Randomness would add nothing. |
| "Multi-tab needs BroadcastChannel election" | Threads are per tab: sealed state is bound to `tabId`, so there is no shared thread that can diverge. ✳ |
| "Don't lint against 500/150/1.5K WebMCP limits" | We never did. Tool names are capped at 64 characters, the provider limit and stricter than 128. ✳ |

## Item-by-item

### 1. Correctness and concurrency

| Item | Status | Where |
|---|---|---|
| Double execution under retry | 🔧 Request-level idempotency: the client sends a `requestId` and retries once; the server claims the id and replays the stored response. Plus exactly-once claims per (thread, tool call) for undoable actions, and outcome replay on grants (✅). `ctx.invocationId` is the idempotency key for your own DB writes. | `engine.ts handle()`, `runtime.ts post()`; tests "a retried request…", "retries a dropped response…", "claims each undoable tool call exactly once" |
| Grant consumption race | ✅ atomic compare-and-set, 🔧 now also proven on real Postgres under 20 concurrent approvals | `grants.ts`, "grant store contract: postgres (PGlite)" |
| TOCTOU between stage and execute | 🔧 At approval, every record is re-resolved through `entity.get` (fresh access check). Optional `entity.version` refuses if the record changed. Handles freeze the exact id set at staging. | `refreshArgs()`; tests "time of check vs time of use" |
| Lost update on a stale snapshot | 🔧 `entity.version` (above). Element actions re-identify the element by ref, role, name and row before acting (✅). | `entity.ts`, `runtime.ts resolveElement` |
| Partial failure mid-sequence | ✅ Writes commit on the server before any navigation effect is applied. Receipts are precise; there is no fake rollback. | `engine.ts execute → effects` |
| Bulk partial success, exact-set undo | ✅ Undo uses the exact resolved set stored at execution. 🗺 A per-item outcome helper for bulk handlers. | `undo` grants |

### 2. Security and abuse

| Item | Status | Where |
|---|---|---|
| Prompt injection, gate holds under contradiction | ✅ A scripted, fully compromised model deletes nothing. | "a fully compromised model cannot delete anything" |
| Planner as a free LLM proxy | ✅ per-user rate limit, step cap, output cap, same-origin only. 🔧 off-task refusal rule, per-user daily request and token `budget`, `onUsage` for spend alerts. | `handler.ts`; "enforces per-user daily budgets" |
| Second-order / stored injection | ✅ entity labels, the screen and context are marked untrusted; UGC regions are non-operable. See the taint correction above. | `untrusted()`, `page.ts` |
| Handle enumeration, cross-thread replay | ✅ per-thread server mapping, signed state with a 24h TTL, re-authorization on every resolve | "cannot act on another user's records" |
| Forged history, results, approvals | ✅ HMAC-sealed thread state bound to user and tab; grants are server-side | "rejects tampered state" |
| Confused deputy | ✅ The `never` tier; 🔧 it is no longer even listed to the model | "never offers human-only actions" |
| Third-party scripts registering tools | ✳ The registry is not on `window`, and same-origin scripts already control the page. 🔧 WebMCP emission is opt-in twice (`<SaydoProvider agents>` and per-action `expose.browserAgent`), registers each tool once per model context, and unregisters on unmount via `AbortSignal`. Browser-agent calls go through the server policy like any other. | `webmcp.ts`; "WebMCP" tests |
| Exfiltration through "safe" actions | ✅ typed internal routes only, declared search params, internal navigate effects, external links confirm, no remote media rendered from model output | "allows only declared, validated search params" |
| CSRF on the planner route | ✅ Origin / Sec-Fetch-Site check; 🔧 JSON-only content-type (415 otherwise) | "accepts JSON only" |

### 3. Consent integrity

| Item | Status |
|---|---|
| Automation can click "approve" | ✅ `isTrusted` required, typed step-up for bulk, `never` tier. 🔧 WebAuthn step-up (`webauthn()`, dependency-free WebCrypto): server challenge, origin, RP ID hash, UP and UV flags, signature and counter checks; per-action `stepUp: true`. |
| A developer-rendered card could misrepresent | ✅ The card data is always the server-built ConfirmView, and approval sends only the grant id. 🔧 The audit log records a digest of the exact view shown (`view`). |
| Confirm fatigue | ✅ undo-over-confirm for reversible actions; `defaultRisk` tunable. 🔧 Gated calls from one step are batched into one card (each item listed, approved together, each executed once). A per-request `confirmBudget` (default 5) escalates further confirmations to step-up. |
| TTL and clock skew | ✅ Expiry is server-only and fails closed, with no silent re-stage. |

### 4. State sync and distributed consistency

| Item | Status |
|---|---|
| Multi-tab divergence | ✳ Threads are per tab (see corrections). |
| Dropped response after commit | 🔧 Request idempotency plus a client retry. The receipt lives in the replayed response. |
| Deploy skew | ✅ `manifestHash` on every request → `reload_required`, never executing across versions. 🔧 `deploymentId` (default `VERCEL_DEPLOYMENT_ID` / `NEXT_DEPLOYMENT_ID`) is recorded on audit entries and served in the manifest. |
| Grant-store contention | 🔧 `postgresGrantStore`: single-statement `INSERT … ON CONFLICT DO NOTHING` and `UPDATE … WHERE state = $from`, no row locks held. The contract is documented on the interface. 🔧 `redisGrantStore`: single-key Lua scripts (Cluster safe), relative TTLs, contract-tested against a real `redis-server`. |

### 5. Model non-determinism

| Item | Status |
|---|---|
| Hallucinated ids, malformed args | ✅ entity handles plus validation; 🔧 retry once with the error, then stop |
| Wrong tool selection | 🔧 a description-overlap lint in `saydo doctor`, and `saydo eval` golden cases (both demos ship `saydo.evals.json`) |
| Retry loops | ✅ loop detection on (tool, canonical args) |
| Parallel calls racing | ✅ calls are processed serially |
| Partially streamed input | ✅ non-streaming planner, so the input is always complete |
| Scoping fights prompt caching | ✅ deterministic tool order; 🔧 stable instructions marked as an Anthropic cache breakpoint, per-request page context after it. 🔧 Cached input tokens are reported separately, and `pricing` turns usage into `costUsd` with cached tokens at their own price. `saydo inspect` shows the estimated input per step for each page. |

### 6. Scale, cost, multi-tenancy

| Item | Status |
|---|---|
| Routes payload | ✅ The manifest stays on the server; the client gets only the user's static pages. |
| Tenant isolation | ✅ Context is per request. Capabilities are code, not tenant data. The memory store is per process, and the durable store is keyed by user. |
| Tenant-authored labels as tool poisoning | ✅ Entity labels are untrusted-wrapped and never become tool descriptions. |
| Herds and 429s | 🔧 a circuit breaker (after 5 failures, 30s of fast 503s with a palette fallback) and a clean `planner_unavailable` code; ✅ palette fallback |

### 7. React / Next runtime

| Item | Status |
|---|---|
| `<Activity>`, StrictMode, tearing | ✅ effect-time idempotent registration, `useSyncExternalStore` |
| Stale closures | 🔧 `useLatest` (see corrections) |
| Unmount mid-flight | ✅ Server writes and receipts do not depend on the component. |
| `router.push` returns void | ✅ The runtime watches the pathname, with a timeout. |
| Route shapes | ✅ groups, slots, interceptors, private folders, catch-alls (scanner tests) |
| Unsaved changes | 🔧 `useSaydoGuard(isDirty)`: the model is told the page is dirty, navigation returns `blocked: unsaved_changes`, and the fast path refuses locally. 🗺 Draft-and-diff for AI form fills. |

### 8. Emission and cross-host

| Item | Status |
|---|---|
| Delegated out-of-band approval for MCP, voice and external clients | 🔧 `external.approvals: 'delegated'`: a gated agent call stages a grant with its `origin` and returns an approval URL. The user approves on the app's authenticated page (`saydo/next/approve`, the same server-built card, a trusted click, passkey when required), and the agent polls `saydo_approval_status`. Only the grant's own user can read or approve it, exactly once. The audit records the origin. This is the URL-mode elicitation pattern, and it needs no client support. |
| Annotations are hints | ✅ Inbound MCP hints never lower risk unless `trustAnnotations`. |
| Non-interactive callers | 🔧 MCP server (`saydo/next/mcp`, `createMcpHandler`): JSON-RPC over Streamable HTTP, `authenticate` required (otherwise 404, and 401 with `WWW-Authenticate` when there is no user). Only `expose.external` actions are listed, `never` never is, ids are checked through `entity.get`, and gated calls are refused unless delegated approval is on. Tested with the real AI SDK MCP client. |

### 9. Privacy and compliance

| Item | Status |
|---|---|
| PII to the provider | ✅ `data-saydo-private`, masked passwords, payment and OTP fields; 🔧 `redact`, on by default (`'basic'`: cards with a Luhn check, SSNs, IBANs; `'strict'` adds emails and phones; or a custom function), applied to screen, element names, form values and context before egress |
| Audit log | 🔧 `createAuditLog`: append-only, hash-chained, with `verifyAuditChain`. Entries carry user, capability@version, tier, decision, consent method, grant id, view digest, planner and manifest hash, and **no arguments** (no PII). |
| Right to erasure | 🔧 `GrantStore.deleteUser(userId)`. Threads are not stored on the server (sealed, client-held, 24h TTL). The audit sink is yours. |
| AI disclosure (EU AI Act Art. 50) | 🔧 The palette shows an AI disclosure line, and the launcher reads "Ask AI". Both are localizable. |

### 10. Reliability and operations

| Item | Status |
|---|---|
| Provider outage | ✅ palette fallback; 🔧 circuit breaker |
| Observability | 🔧 `onUsage` (tokens, cached tokens, `costUsd`), `audit`, `onError`. 🔧 `tracer`: OpenTelemetry-compatible spans `saydo.plan` (step, tool count, `gen_ai.usage.*`) and `saydo.execute` (capability, risk, status; errors marked). A broken tracer never breaks a request. |
| Deterministic CI | ✅ `mockPlanner`, scripted adversarial planners, `saydo eval` |
| Chaos | ✅ network-down and model-down tests; 🔧 dropped-response replay test. 🗺 A WAREX-style fault-injection suite. |

### 11. Accessibility and i18n

| Item | Status |
|---|---|
| Announce, focus, reduced motion, keyboard, push-not-replace | ✅ |
| Localization | 🔧 Every UI string is overridable via `messages` on `<SaydoProvider>`. Confirm text comes from your `title` or `confirm.view`. Model-facing text can stay in English; the model replies in the user's language. |

### 12. Supply chain

| Item | Status |
|---|---|
| Signed releases | 🔧 `.github/workflows/release.yml`: on a `v*` tag it type-checks, tests (with real Redis), builds, checks every export, verifies the tag matches the package versions, and runs `npm publish --provenance`. `ci.yml` also builds both examples and installs both templates from packed tarballs. |
| No egress of its own | ✅ The core calls only your model provider (through the AI SDK) and the tool sources you configure. |
| Disclosure policy | 🔧 `SECURITY.md`. |

## Launch gates

| Gate | State |
|---|---|
| **Production blockers:** idempotent execution, atomic grants, server-authoritative risk/threads/grants, injection gate, exfiltration guards, tenant isolation | Met (✅ + 🔧). Durable stores: Postgres 🔧, Redis 🔧. |
| **Scale blockers:** deploy skew, store contention, caching-aware cost, budgets, graceful degradation | Met (🔧 `deploymentId`, `pricing` → `costUsd`, tracing) |
| **External reach:** delegated approval, canonical approval view | Met: canonical view ✅; delegated approval, MCP server and WebMCP 🔧 |
| **Standard 1.0:** IP policy, must-ignore extensibility, i18n model, a second implementation | 🔧 [IP-POLICY.md](../IP-POLICY.md) draft (spec under CC BY 4.0 with an OWFa 1.0 patent commitment, DCO, RFC process). 🔧 SPEC §14 versioning: `protocolVersion`, must-ignore, `x-` extensions. 🔧 A framework-free client (`saydo/dom`). 🗺 A second *server* implementation in another language before 1.0, and legal review of the IP policy. |
