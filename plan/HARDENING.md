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
| Delegated out-of-band approval for MCP, voice and external clients | 🔧 `external.approvals: 'delegated'`: a gated agent call stages a grant with its `origin` and returns an approval URL. The user approves on the app's authenticated page (`saydo-js/next/approve`, the same server-built card, a trusted click, passkey when required), and the agent polls `saydo_approval_status`. Only the grant's own user can read or approve it, exactly once. The audit records the origin. This is the URL-mode elicitation pattern, and it needs no client support. |
| Annotations are hints | ✅ Inbound MCP hints never lower risk unless `trustAnnotations`. |
| Non-interactive callers | 🔧 MCP server (`saydo-js/next/mcp`, `createMcpHandler`): JSON-RPC over Streamable HTTP, `authenticate` required (otherwise 404, and 401 with `WWW-Authenticate` when there is no user). Only `expose.external` actions are listed, `never` never is, ids are checked through `entity.get`, and gated calls are refused unless delegated approval is on. Tested with the real AI SDK MCP client. |

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
| **Standard 1.0:** IP policy, must-ignore extensibility, i18n model, a second implementation | 🔧 [IP-POLICY.md](../IP-POLICY.md) draft (spec under CC BY 4.0 with an OWFa 1.0 patent commitment, DCO, RFC process). 🔧 SPEC §14 versioning: `protocolVersion`, must-ignore, `x-` extensions. 🔧 A framework-free client (`saydo-js/dom`). 🗺 A second *server* implementation in another language before 1.0, and legal review of the IP policy. |

---

# Round 2: the "Next.js of AI" review and conversation storage

Date: 2026-10-18 (same day, after the first round). The second analysis again assumed an empty workspace and that conversation storage was undecided. Every item below was checked against the code. Test count after this round: `pnpm test`, 196 passing. Legend as above.

## Correction on the promise

The analysis says "do anything with AI" is the wrong promise. Saydo never made that promise. It promises that the assistant can do what *this user* can do *in this app*, limited by what the developer allows, with every consequential step waiting for the user's click on a card built from the real arguments. "Full freedom" (the user's decision) refers to the default *scope*, meaning the visible page and every element. It does not relax the consent gate or the user's own permissions. ✳

## Item by item

| Area | Item | State |
|---|---|---|
| 1 Composition | Multi-step requests need a typed home, not prompt-invented control flow | 🔧 `workflow({ steps })`: a developer-declared order and data flow, and one consent decision on a card listing every step. Its risk is at least the riskiest step's. Completed steps are undone in reverse on failure, and the receipt says which steps stay done. The model can still chain separate actions; each gated one confirms (✅), and calls in one step are batched into one card (✅). |
| 2 Discovery at scale | Retrieval over thousands of actions, with a deterministic fallback | ✅ `maxTools` scoping plus `find_capability`. 🔧 `search: { embed }` ranks actions by meaning, both for the surfaced set and inside `find_capability`. Descriptions are embedded once per process. Exact keyword hits come first, and embedder failures fall back to keywords. |
| 3 RSC / caches | AI writes must invalidate caches | 🔧 Every successful non-read server action now adds `refresh` (`router.refresh()` in Next, an event in React Router). 🔧 `invalidate(...keys)` effect plus `onInvalidate` on every provider and on `saydo-js/dom`, plus a `saydo:invalidate` DOM event, for React Query, SWR and stores. Handlers run in a Next route handler, so `revalidatePath` / `revalidateTag` work as usual. |
| | Server Components can't register capabilities | ✳ Declarations are isomorphic (`saydo`), handlers are `server-only` modules found by the build, and mounting (`useAction`) is client-only. Verified by real `next build` runs of both templates. |
| | `useOptimistic` and AI writes | ✳ AI writes are never optimistic: effects apply only after the server receipt, so there is nothing to reconcile. |
| | State managers | 🔧 `onInvalidate` is the one binding they need (one line for TanStack Query). |
| 4 Reliability | Record/replay as a subsystem | 🔧 `record` captures every request: planner inputs (already redacted), outputs, events, effects. `replayPlanner(records, { strict })` replays it deterministically and fails on tool drift. |
| | Structured-output repair | ✅ Invalid arguments are retried once with the validation error, then the turn stops cleanly. |
| | Provider failover, model routing | 🔧 `model: [primary, backup]` fails over per step. ✅ The circuit breaker and palette fallback. Per-capability model routing: ✳ use `planner` (the escape hatch) when it is needed. |
| 5 Latency | Fast path, SLOs | ✅ Navigation is answered locally with no model call. 🗺 Streaming responses and speculative prefetch. A latency SLO in CI needs a real model and network to mean anything; `onUsage` and `tracer` give the production numbers. |
| 6 Permissions | Policy-as-code | 🔧 `authorize({ user, capability, input, origin })` runs on the server for every call (assistant, MCP, browser agents) after records are resolved. It can deny, require confirmation or require step-up, never lower risk. Errors deny. ✅ `can(user)`, route `access`, entity `get` authz. |
| 7 Versioning | Capability semver, in-flight grants | 🔧 Grants record the capability version; a different version at approval is `reload_required` and never runs. ✅ `manifestHash` skew handling, the lockfile, SPEC §14 versioning rules. |
| 8 Error taxonomy | Closed, documented outcomes | ✅ Fixed `ReceiptStatus` enum, a `fix` for every status (unit-tested), authored messages only, never raw exceptions (SPEC §8). |
| 9 i18n of intent | Locale in the envelope | 🔧 `ClientContext.locale` (from `navigator.language`, validated), and the model replies in that language. ✅ Every UI string is localizable (`messages`), and confirm text is yours. |
| 10 DX | create-app, devtools, type safety, evals | ✅ `create-saydo-app`, `saydo init`, the dev inspector (tools, risks, token and cost estimates), `saydo eval` and `doctor`, the mock planner. 🗺 A replay viewer in the inspector (records exist now). |
| 11 Standard | Spec, conformance, second implementation, IP, extensibility | ✅ / 🔧 from round 1. 🔧 SPEC: §3.5 workflows, §3.6 versions, §3.7 third-party text, the §4 policy rule, §9.1 the stored-conversation profile, §9.2 offline. 🗺 A non-TypeScript server implementation. |
| 12 Security | Manifest signing | ✳ Same-origin TLS from the server that also serves the code: anyone able to alter the manifest can alter the JavaScript, so a signature adds nothing (SPEC §15). |
| | Local-first / offline profile | ✳ Decided (SPEC §9.2): gated actions need a server; offline, the palette works and the assistant reports itself unavailable. No weaker "local consent". |
| | Tenant-authored text as tool poisoning | 🔧 MCP and OpenAPI descriptions are labeled `[Third-party description]`, flattened and capped at 500 characters, and the model is told never to follow them (`trusted: true` for sources you control). They default to `destructive`. |
| | Bug bounty | 🗺 With the first public release (needs the maintainers' program). |

## Conversation storage (the store-plugin request)

The analysis proposed a pluggable store with an optimal Firestore option. Built as follows:

- **Default: nothing stored.** The browser tab holds signed state, so there is zero setup and no PII at rest. A database is never forced on anyone.
- **Opt-in `threads` store.** With it, the browser holds a 200-byte signed pointer bound to user and tab, and the server holds the working state plus an append-only transcript. Users get **History** in the palette (or `useConversations()`), resume in any tab or device, and deletion.
- **The contract (`ThreadStore`, 7 methods):**
  - `save` is an atomic compare-and-set on `version`, so concurrent turns can't overwrite each other.
  - The transcript is append-only, one record per line, so there is never a growing hot document.
  - It also covers listing by user, delete, and `deleteUser` for erasure.
  - The same contract suite runs against every store.
- **Plugins:**
  - `memoryThreadStore()`
  - `postgresThreadStore(pool)`, tested on PGlite
  - `firestoreThreadStore(db)` and `firestoreGrantStore(db)`, so Firestore can be the only database:
    - transactions for compare-and-set and single-use grants
    - a `entries` subcollection for the transcript
    - `expireAt` fields for TTL policies
    - one composite index for listing
    - URL-encoded document ids
    - JSON-string payloads, so Firestore's nested-array limits never bite
- **Verified on Firestore:**
  - The interface is type-checked against the real `firebase-admin` 14.5 types.
  - The contract suite runs locally against a faithful in-memory fake (transaction retries, interleaved reads, rejected `undefined`).
  - In CI it runs against the real Firestore emulator (`firestore` job). This machine has no Java, so the emulator run happens in CI or with `pnpm test:firestore` after installing a JDK.
- **Failure modes covered:**
  - A store outage while finishing a turn falls back to sealed state, so executed actions never lose their response.
  - A load failure gives `store_unavailable` with a fix.
  - Expired or foreign conversations are refused.
  - A tampered pointer is refused.
- **Retention:** 30 days after the last message (`threadTtlMs`); `prune()` on Postgres, TTL policies on Firestore.
- **Why Firestore is not the default:**
  - It solves the atomicity and TTL needs natively, which is why it is a first-class plugin.
  - Making any database the default would couple the zero-config path to a vendor.
  - Real-time listeners were not needed: threads are per tab by design (✳).

---

# Round 3: security and scale review of the code

Date: 2026-10-18. This review read the actual code and was precise, so most findings were confirmed and fixed. Test count after this round: `pnpm test`, 221 passing. CI on GitHub Actions (Node 22 and 24) is green, including the store contracts against the **real Firestore emulator**, which closes the gap left open in round 2.

| # | Finding | Verdict | Fix |
|---|---|---|---|
| S1 | Without `getUser` every visitor was `anonymous`, sharing grants, stored conversations and limits | ✅ Confirmed, and worse than stated: the rate limit was shared by all visitors | 🔧 Each browser gets its own sealed `saydo_visitor` identity (HttpOnly, SameSite=Lax, Secure on https). Cookie-less clients are also limited per client IP (the platform proxy header, or the socket address passed out-of-band by `saydo-js/node`, never a forgeable header). Production refuses data-changing server actions and stored conversations without `getUser` unless `anonymous: true`, with code `no_user` and a fix. |
| S2 | `bulkCount` misses filter-shaped inputs | ✅ Confirmed | 🔧 `blastRadius(input, { user })` on any capability. It drives tier 3 (step-up), the typed count, and an "Affects N records" line on the card, for the assistant and for agents. Errors count as unlimited (fail closed). |
| S3 | Taint does not raise the tier | ✅ Confirmed (round 1 had declined it as confirm fatigue) | 🔧 Narrowed so it doesn't cause fatigue. A request is tainted only by *strong* signals: developer-marked untrusted page regions (`data-saydo-untrusted`, sent as ⟦…⟧), results of imported tools (MCP, OpenAPI, AI SDK), and actions declared `untrustedResults`. Tainted requests cannot auto-run reversible steps; they confirm, and the card says why. Taint resets with the next user message. `taint: 'off'` opts out. |
| S4 | Are third-party *results* spotlighted? | ✅ Confirmed gap: only descriptions were labeled | 🔧 Untrusted results carry `receipt.untrusted` and reach the model as `<untrusted>…</untrusted>` text, with angle brackets neutralized and the length capped. `trusted: true` per source; tRPC (your router) is trusted by default. |
| S5 | No `Permissions-Policy: tools=()` | ✅ Partly. The WebMCP spec does define the policy-controlled feature `tools` (default allowlist `'self'`). The proposed `tools=()` would also block the app's own tools. No header can separate a third-party script in the page from the app, since both run as the page's origin. | 🔧 By default `withSaydo`, the Vite dev server and `serveStatic` send `tools=()`, so no script on the page can register browser-agent tools. With `agents: true` they send `tools=(self)`. If the policy blocks registration, the browser warns with the fix. |
| C1 | Rate limit, budget and breaker are per instance; budget map cleared wholesale | ✅ Confirmed | 🔧 `LimitStore` with `memoryLimitStore` (expired windows dropped one by one; nobody's budget resets early) and `redisLimitStore` (one atomic Lua script per hit, contract-tested on a real `redis-server`). Rate limits use fixed windows that work the same across instances. The circuit breaker stays per instance on purpose (✳): each instance reacts to its own evidence. |
| C2 | Firestore transcript `seq` can collide across instances | ✅ Confirmed | 🔧 The engine numbers transcript entries from a counter inside the conversation state, which is saved with compare-and-set. Firestore orders by it. A new contract test proves the order survives skewed clocks, on every store. |
| C3 | Sealed state is signed, not encrypted | ✅ Confirmed | 🔧 Encrypted rather than only documented: AES-256-GCM with an HKDF-derived key (WebCrypto, edge-safe). The browser can no longer read results, handles or history. |

**Also found while fixing:**

- The body cap trusted `content-length`; it now counts bytes as they are read.
- The Node adapter (`toNodeHandler`) kept only the last `Set-Cookie` and buffered whole responses; it now passes every cookie and streams.
- "New chat" during a running request let the late answer land in the new conversation; results of older requests are now discarded.
- CI on Node 20 could not run the jsdom tests (Node 20 is end-of-life). The test matrix is now Node 22/24, `engines` is `>=22`, actions are on current majors, and test failures appear as public annotations.

## The customization gaps

| Gap | Result |
|---|---|
| Per-request model | 🔧 `model: ({ user, route }) => model \| [primary, backup]`. |
| Per-tenant or bring-your-own key | 🔧 Covered by the same hook: return a provider created with that tenant's key. You judged a dedicated feature unnecessary, and none is needed. |
| Streaming | 🔧 The AI SDK planner streams with `streamText`. The handler answers `stream: true` requests with NDJSON (text events, then exactly one authoritative result), and the provider and `saydo-js/dom` render the reply as it is written (`stream={false}` to opt out). Failover happens only before any text is shown. A dropped stream is retried by `requestId` and gets the stored result. |
| Per-request config | 🔧 `instructions: ({ user, route }) => …`. |

**Still open:** a measured token-cost comparison of tool search vs prompt caching under real load. It needs a real provider, real traffic and a budget, so it belongs to the testing phase; `onUsage`, `pricing` and `tracer` produce the numbers.

---

# Round 4: product review (live feel, knowledge, config shape)

| # | Suggestion | Result |
|---|---|---|
| 1 | Streaming with visible steps | 🔧 Text streamed in round 3; now each step is also streamed as it starts ("Opening Billing…", "Creating a draft…"), shown as a live status line in the palette and in `saydo-js/dom`. |
| 2 | Answer "how do I…" from the app itself | 🔧 `app_guide` tool, built from three sources: `knowledge.docs` (your how-tos, static or per request), a guide generated from routes, page titles and action descriptions (where each lives, what needs confirmation, workflow steps), and the UI actions on the current page. The assistant explains the steps, then offers to do them. `knowledge.guide: false` turns off the generated part. The demo planner uses it too. |
| 3 | Ask instead of guess | 🔧 `ask_user` tool: one short question with 2–6 options, rendered as clickable choices. The turn ends and the click is the next message. `act.clarify: false` turns it off. |
| 4 | A wider instant path | 🔧 Developer-declared `phrases` on UI actions run in the browser with no model call. "undo that", "go back" and "new chat" are instant. Navigation by page name already was. |
| 5 | Config down to the essentials | 🔧 `saydo.config.ts` is now structured: `model`, `getUser`, `store` and `instructions` at the top, then one group per question: `knowledge` (what it knows), `see` (what it may look at), `hide` (what it must never know: routes, actions, fields, selectors, context keys), `act` (what it may do and how it asks), `tools`, `limits`, `conversations`, `agents`, `observe`, `advanced`. Old or misplaced keys print a warning naming the new place. `getUser: 'anonymous'` replaces the separate flag. |
| 6 | A lighter browser side | Measured: about 25 KB gzipped before the app's own minification. 🗺 Loading the palette only when first opened is the next step; `ui={false}` already ships none of it. |

**Also:**
- The website (`site/`) is a Next.js app built on Saydo: ⌘K everywhere, and a playground where developers try a board with the built-in demo planner or their own Anthropic/OpenAI key.
- The key is sent per request, used once, and never stored or logged. Provider errors (a bad key, rate limits) become plain answers, so one visitor's key can't trip the shared circuit breaker.
- The framework gained `PlanOptions.request` and a provider `headers` option for this.
