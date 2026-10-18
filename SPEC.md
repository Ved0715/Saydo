# Saydo Protocol — Draft v0.2

Status: working draft. Protocol version `0.2`. The reference implementation is the `saydo` package in `packages/saydo`. Contributions are covered by [IP-POLICY.md](IP-POLICY.md).

## 1. Scope

This document specifies how a web application declares what an AI assistant may do inside it, and how a host executes those actions safely on behalf of a signed-in user.

It defines:

- the declarations: capabilities, entities and routes
- a turn protocol between the client and the server
- consent tiers and the grant lifecycle
- receipts

It does **not** define a model transport. Implementations compile declarations into existing tool formats (AI SDK tools, MCP tools, WebMCP `registerTool`, AG-UI frontend tools).

Key words MUST, SHOULD and MAY are as in RFC 2119.

## 2. Conformance levels

| Level | Requires |
|---|---|
| **L0** Navigation | Route manifest (§5), `nav_goto` (§7.2), per-user route filtering, a non-AI route palette |
| **L1** Actions | L0 + capabilities (§3), receipts (§8), sealed thread state (§9) |
| **L2** Consent | L1 + tiers (§4) and grants (§6) enforced on the server |
| **L3** Emission | L2 + at least one external mapping (§10) with the non-interactive policy (§6.5) |

The reference implementation targets L3 (MCP server and WebMCP, with delegated approval).

## 3. Capability

A capability is a singleton, invocable unit. Target records MUST be passed as input; implementations MUST NOT register one capability per record.

```ts
interface CapabilityDescriptor {
  id: string;              // /^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/i, e.g. "posts.delete"
  version?: number;        // default 1; bump on breaking input changes
  describe: string;        // for the model; SHOULD be ≤ 500 chars (WebMCP limit)
  input: JSONSchema;       // object schema (draft-07 subset compatible with OpenAI strict mode and MCP)
  risk?: 'read' | 'reversible' | 'write' | 'destructive' | 'never';  // default 'destructive'
  kind: 'server' | 'client';
  entry?: string;          // client kind: route pattern to open before dispatch
  expose?: { assistant?: boolean; browserAgent?: boolean; external?: boolean }; // default assistant only
}
```

Rules:

- **3.1** Unspecified `risk` MUST be treated as `destructive`. This matches MCP's `destructiveHint` default.
- **3.2** A `reversible` capability MUST provide an undo operation. Implementations SHOULD enforce this at the type level.
- **3.3** A server capability's permission predicate (`can(user)`) MUST be evaluated on the server. A capability failing it MUST NOT be offered to the model.
- **3.4** Effects returned by a handler are declarative: `navigate` (internal path only), `refresh`, `toast`, `invalidate { keys: string[] }` (client caches the host maps to its data layer). A `navigate` effect whose href is not a same-origin path (starts with `/`, not `//`) MUST be dropped. After a successful non-`read` server capability, the server SHOULD add `refresh` when the handler did not, so the UI never shows data the action changed.
- **3.5 Workflows.** A workflow is a capability composed of other server capabilities, in an order and with a data flow declared by the developer; the model supplies only the workflow's input. Its risk MUST be at least the highest risk of its steps (a workflow of only `reversible` steps without its own undo is `write`), and a step of risk `never` MUST be rejected at definition. The confirmation view MUST list every step. If a step fails, completed steps with an undo operation SHOULD be undone in reverse order, and the receipt MUST state which completed steps remain in effect.
- **3.6 Versions.** A grant MUST record the capability version it was staged against; approving it against a different version MUST yield `reload_required` without executing.
- **3.7 Third-party descriptions.** Descriptions imported from other systems (MCP servers, OpenAPI documents) are untrusted text. Implementations MUST label them as such to the model and SHOULD cap their length.

## 4. Consent tiers

The tier is computed **only on the server**, from the server's own copy of the descriptor and the validated arguments. Client-supplied risk, tier or descriptor data MUST be ignored.

**Blast radius.** For tier 3, the number of affected records is the capability's own count when it declares one (`blastRadius`, for filter-shaped inputs), otherwise the largest list input. A failing count MUST be treated as unlimited.

**Taint.** When a request has read untrusted content (developer-marked page regions, results of imported tools, or results a capability declares untrusted), implementations SHOULD raise tier 1 calls in the rest of that request to tier 2. Untrusted results MUST reach the model marked as untrusted data.

| Tier | From risk | Consent | Non-interactive callers |
|---|---|---|---|
| 0 | `read`, UI actions, navigation | none | MAY if exposed |
| 1 | `reversible` | execute, then offer a single-use undo token | opt-in |
| 2 | `write`; `destructive` affecting ≤ N records (default N = 5) | confirmation with a trusted user gesture | MUST refuse by default |
| 3 | `destructive` affecting > N records | tier 2 + step-up (typed confirmation or WebAuthn user verification) | MUST refuse |
| 4 | `never` | never executed; the assistant may only direct the user to the page | MUST refuse |

UI actions registered by mounted components are tier 0. They MUST NOT mutate server state.

**Policy.** An implementation MAY evaluate a deployment policy for every capability call, on the server, after validation and record resolution. A policy MAY deny a call or raise its tier (to 2, or to 3); it MUST NOT lower a tier. A policy error MUST be treated as a denial.

## 5. Routes and entities

**Route manifest.** Routes are derived from the host router (for Next.js: the App Router tree). The following MUST be treated as follows:

- route groups `(x)`: transparent, contributing no URL segment
- parallel slots `@x`, intercepting routes `(.)x`, and private folders `_x`: not pages
- dynamic segments: unsatisfiable unless bound

Optional per-route metadata: `title`, `aliases`, `params` (segment → entity binding), `search` (schema for URL state), `access(user)`, `hidden`.

- **5.1** A dynamic route MUST be withheld from the model unless every dynamic segment is bound to an entity. Catch-all segments are withheld unless explicitly bound.
- **5.2** Route visibility MUST be filtered per user on the server. Withheld routes MUST NOT appear in prompts or palettes.
- **5.3** Search parameters MUST be declared. Undeclared keys MUST cause rejection, not silent stripping. Free-form query strings are an exfiltration channel.

**Entity.** `{ type, label(record), get(id, ctx), find?(query, ctx) }`.

- **5.4** `get` is the authorization boundary. Every handle MUST be re-resolved through it at use time.
- **5.5** The model MUST only ever see opaque, thread-scoped **handles** (`post#3`), minted by the server from the current page, from `entities_find`, or from earlier results. Raw ids from the model MUST be rejected.
- **5.6** Entity labels and other app content are untrusted. They MUST be delimited when placed in model context (for example `<untrusted>…</untrusted>` with angle brackets escaped).

## 6. Grants

### 6.1 State machine

```
staged ──approve(trusted)──▶ consumed            (server capability)
staged ──approve(trusted)──▶ approved ──withGrant──▶ consumed   (client capability)
staged ──deny / expire / superseded──▶ denied
approved ──receipt without consumption──▶ denied
```

### 6.2 Grant record

A grant records: `{ id, kind, capabilityId, userId, threadId, tabId, toolCallId, args, tier, state, createdAt, expiresAt, typed?, outcome? }`.

### 6.3 Requirements

- **6.3.1 Stage by reference.** `args` are the validated, entity-resolved arguments stored server-side. Approval transmits only the grant id. Execution MUST use the stored arguments.
- **6.3.2 Single use.** Each transition MUST be an atomic compare-and-set.
- **6.3.3 Replays.** A retried approval of a consumed grant MUST replay the recorded `outcome` and MUST NOT re-execute.
- **6.3.4 Expiry fails closed.** An expired grant yields an `expired` receipt and MUST NOT be re-staged automatically.
- **6.3.5 Approval requirements:**
  - the request comes from the same user and tab
  - the client attests a trusted input event (`isTrusted`)
  - for tier 3, the step-up proof (the typed text, or WebAuthn)
- **6.3.6 Superseded grants.** A new user message while a grant is pending MUST deny it. The human always wins.
- **6.3.7 Matching client requests.** When a client capability's request reaches an existing endpoint, the endpoint MUST verify and consume the grant. Implementations MUST compare the request against the approved arguments, either with an explicit matcher or by RFC 8785 canonical equality after NFC normalization. Requests without a grant header are ordinary user requests.

### 6.4 The confirmation view

The confirmation view MUST be built by the server from the stored arguments:

```ts
{ title, danger?, fields: [{ label, value, untrusted? }], requireTyped?, confirmLabel? }
```

- It MUST show complete details without truncation (OWASP AISVS 9.2.2).
- Model-written prose MUST NOT be what the user approves. It MAY be displayed separately and labeled as such.

### 6.5 Non-interactive callers

Browser agents and external MCP clients have no human at the card. A capability is visible to them only when it opts in (`expose.browserAgent`, `expose.external`); tier 4 is never visible. Tier ≥ 2 MUST be refused (`forbidden`, code `approval_required`) unless the deployment enables **delegated approval**:

1. The agent calls `invoke`. The server validates, resolves ids through the entity `get` (authz applies), and stages a grant exactly as in §6.1, marked with its `origin` (`external` or `browser-agent`).
2. The server answers `needs_approval` with `{ grantId, view, tier, expiresAt, url }`. `url` is an app page (default `/saydo/approve/<grantId>`).
3. The user opens the page signed in to the app. It shows the same server-built ConfirmView (§6.4) and approves with a trusted gesture, plus step-up when required (§6.6), through `grant-approve`. Only the grant's own user can read or approve it.
4. The agent polls `grant-status` (MCP: the `saydo_approval_status` tool) and receives the receipt once approved. Denial and expiry are terminal.

For in-page browser agents the same grant is shown as the normal confirm card in the app's own UI; the agent's call resolves when the user decides. This is the out-of-band pattern of MCP URL-mode elicitation, without requiring client support for it.

Note: a trusted click is not proof of a human, because browser automation produces trusted events. Tier 3 SHOULD use WebAuthn user verification where available (§6.6).

### 6.6 Step-up

A grant MAY require step-up: tier 3 in bulk, capabilities declared `stepUp: true`, or a request that exceeded its confirmation budget. The pending action then carries a `stepUp` challenge (WebAuthn `PublicKeyCredentialRequestOptions`, base64url) and the approval MUST include a `proof` assertion with user verification. The server verifies the challenge it issued, the origin, the RP ID hash, the UP and UV flags, the signature over `authenticatorData ‖ SHA-256(clientDataJSON)`, and a non-decreasing signature counter. If the user has no passkey, the pending action carries `stepUpMissing: true` and the server MAY fall back to typed confirmation.

## 7. Turn protocol

All messages are JSON over a same-origin POST. Servers MUST reject cross-site requests (`Origin` or `Sec-Fetch-Site`).

### 7.1 Requests

```ts
type TurnRequest =
  | { type: 'manifest' }
  | { type: 'message';  text: string; state?: string; client: ClientContext }
  | { type: 'receipt';  state: string; toolCallId: string; receipt: Receipt; client: ClientContext }
  | { type: 'approve';  state: string; grantId: string; approved: boolean; trusted?: boolean; typed?: string; proof?: unknown; client: ClientContext }
  | { type: 'undo';     token: string; state?: string; client: ClientContext }
  // agents (§6.5)
  | { type: 'invoke';        tool: string; args: unknown; client: ClientContext }       // in-page browser agents
  | { type: 'grant-status';  grantId: string }
  | { type: 'grant-approve'; grantId: string; approved: boolean; trusted?: boolean; typed?: string; proof?: unknown }
  // stored conversations (§9.1)
  | { type: 'threads'; limit?: number }
  | { type: 'thread-open'; threadId: string; client: ClientContext }
  | { type: 'thread-delete'; threadId: string };
// Every request MAY carry `requestId` (8–100 chars [A-Za-z0-9_-]). A repeated requestId from the
// same user returns the stored response and never executes twice.

interface ClientContext {
  route: string;                 // pathname + search
  tabId: string;
  mounted: string[];             // ids of mounted client capabilities and UI actions
  uiActions: { id: string; describe: string; inputSchema?: JSONSchema }[];
  context?: Record<string, unknown>;   // untrusted page context, budgeted
  page?: PageSnapshot;                 // the visible page, when the server allows it (§7.5)
  manifestHash?: string;
  locale?: string;                     // BCP 47; the assistant replies in this language
}
```

`ClientContext` can narrow what is offered (by reporting what is mounted). It can never widen permissions or change a tier.

### 7.2 Built-in tools

- `nav_goto { route: <pattern enum>, params?: { [segment]: handle }, search?: { [declared key]: string } }`
- `entities_find { type, query }` → `{ matches: [{ handle, label }] }`. Labels are untrusted.
- `page_act { ref, action: click|fill|select|check|uncheck|submit, value? }`: operate an element from the screen outline (§7.5).
- `find_capability { query }`: offered when more actions exist than `maxTools`. Matches become callable tools for the rest of the turn.

### 7.3 Responses

```ts
type TurnResult =
  | { ok: true; state: string; events: DisplayEvent[]; effects: Effect[]; pending?: PendingAction; done: boolean }
  | { ok: false; status: ReceiptStatus; message: string; fix: string };

type PendingAction =
  | { type: 'confirm';  toolCallId; grantId; capability; view: ConfirmView; tier; expiresAt }
  | { type: 'dispatch'; toolCallId; kind: 'capability' | 'ui'; target; args; entry?; grant? };
```

**Streaming.** A request MAY carry `stream: true`. The server then answers `application/x-ndjson`: zero or more `{ "type": "text", "text": string }` events with the reply as the model writes it, then exactly one `{ "type": "result", "result": TurnResult }`. Text events are display-only; the result is authoritative and MUST be identical to the non-streamed answer. A client that loses the stream MUST retry with the same `requestId`, and receives the stored result.

### 7.4 Loop semantics (server)

- **Calls.** Calls within a step are processed serially. Processing pauses at the first `confirm` or `dispatch`, and the remaining calls stay queued in the sealed state.
- **Loop detection.** An identical `(tool, canonical args)` pair repeated within a turn MUST stop the turn (`loop_detected`).
- **Step cap.** Steps per turn MUST be capped (reference default: 6).
- **Navigation-only steps.** A step consisting only of successful navigation ends the turn without another model call.
- **Partial input.** Implementations MUST NOT dispatch on partially streamed tool input.

### 7.5 Page vision and element actions

The client MAY send `page: { text, elements[] }`: a visible-only outline of the current screen plus operable elements, each with `{ ref, role, name, actions, describe?, risk?, inForm?, submits?, form?, href?, external?, context?, formValues? }`.

- The client MUST exclude `[data-saydo-private]` subtrees, hidden elements, password, payment and one-time-code values, and the assistant UI itself.
- Content inside `[data-saydo-untrusted]` MAY be included as text, marked as user-written, but its elements MUST NOT be operable.
- The server MUST wrap the outline as untrusted data in model context.
- Element risk is decided **on the server**:

| Element action | Risk |
|---|---|
| Developer annotation (`data-saydo-risk`) | as annotated |
| `fill`, `select` | `read` |
| `check` / `uncheck` inside a form | `read` |
| `click` on an internal link | `read` |
| any other click or submit | `act.defaultRisk` (default `write`) |

- Tier ≥ 2 element actions stage a grant whose ConfirmView names the page, the element, its row context, and for submits the non-sensitive form values that will be sent.
- On approval the grant is consumed and the action is dispatched to the browser.
- Before acting, the client MUST re-identify the element by ref, role and name (and context). It MUST refuse when the element is ambiguous or gone.

### 7.6 Tool sources

External tools (MCP servers, AI SDK tools, OpenAPI operations, tRPC procedures) are normalized into capabilities with a JSON Schema input.

- Unmapped tools MUST default to `destructive`.
- Hints from external servers (for example MCP `readOnlyHint`) MUST NOT lower risk unless the deployment opts in.
- Error bodies from external APIs MUST NOT be passed to the model.
- Source names are recorded in the lockfile.

## 8. Receipts

```ts
interface Receipt {
  status: 'ok' | 'needs_confirmation' | 'denied' | 'expired' | 'cancelled' | 'invalid_args' | 'not_found'
        | 'forbidden' | 'precondition_failed' | 'not_ready' | 'blocked' | 'timeout' | 'reload_required'
        | 'loop_detected' | 'error';
  code?: string; result?: unknown; message?: string; fix?: string; retryable?: boolean; route?: string; undoable?: boolean;
}
```

- **8.1** Every status MUST have a default `fix`, phrased as an instruction to the model.
- **8.2** `message` MUST be authored by the framework or the developer. Raw exception text MUST NOT reach the model, because it would be a second-order injection channel.
- **8.3** Receipts MUST be recorded in the thread state before the response is sent.

## 9. Thread state

The server MUST NOT trust client-supplied conversation history. Sealed state MUST be authenticated and SHOULD be encrypted, since it carries action results and record handles. The reference implementation uses AES-256-GCM with a key derived from the deployment secret by HKDF-SHA-256. An implementation MAY instead store the state server-side (§9.1).

**Identity.** Every grant, conversation and limit is keyed by the user. A server without an authenticated user MUST NOT key them all by one shared identity. The reference implementation issues each browser its own sealed visitor identity, also limits cookie-less clients per client IP, and in production refuses data-changing capabilities and stored conversations without an authenticated user unless the deployment explicitly allows anonymous visitors.

Sealed state contains:

- `{ threadId, userId, tabId, issuedAt }`
- the history
- the handle table
- the pending queue
- per-turn loop and step counters

Verification MUST reject:

- a bad signature
- a different user
- a different tab
- an age greater than the TTL

**Deploy skew.** The client sends `manifestHash`. On a mismatch the server MUST answer `reload_required` and MUST NOT execute.

### 9.1 Stored conversations (optional profile)

A server MAY store conversations instead of sealing the whole state. The client then holds a sealed pointer `{ v: 2, ref: threadId, userId, tabId, issuedAt }`, verified exactly as above; the stored thread MUST also belong to the requesting user and MUST NOT be expired. The manifest advertises the profile with `settings.history: true`.

A conversation store MUST provide:

- an atomic compare-and-set save keyed on a monotonically increasing version, so concurrent requests on one conversation cannot silently overwrite each other
- an append-only transcript (what the user saw), stored as one record per entry
- listing by user, deletion of one conversation, and deletion of all of a user's conversations (erasure)

Opening a stored conversation (`thread-open`) MUST issue a new pointer bound to the requesting tab. If the store fails while finishing a request, the server MUST still return the response (for example by falling back to sealed state for that request); it MUST NOT discard the outcome of actions that already executed.

### 9.2 Offline and local-first

Gated actions (tier ≥ 1) require a reachable server that holds grants. This draft defines no local-only consent profile: offline, a host SHOULD keep its non-AI route palette working and SHOULD report the assistant as unavailable, rather than weakening consent.

## 10. Emission mappings (L3)

| This spec | MCP tool annotations | WebMCP `ToolAnnotations` |
|---|---|---|
| `read` | `readOnlyHint: true`, `idempotentHint: true` | `readOnlyHint: true` |
| `write` | `destructiveHint: false` | `consequentialHint: true` |
| `destructive`, `never` | `destructiveHint: true` | `consequentialHint: true` |
| untrusted labels or results | — | `untrustedContentHint: true` |

Annotations are hints. Enforcement stays with §4 and §6.

- WebMCP emission MUST feature-detect `document.modelContext`, falling back to `navigator.modelContext`.
- Hosts SHOULD serve `Permissions-Policy: tools=()` (WebMCP's policy-controlled feature) unless the app emits browser-agent tools, and `tools=(self)` when it does.
- Tools MUST be registered with an `AbortSignal` tied to component unmount.
- Implementations MUST NOT register a tool twice (native and polyfill).

**MCP server.** An implementation MAY expose `expose.external` capabilities as an MCP server (Streamable HTTP; JSON responses are sufficient, since the server never initiates messages). Requirements:

- Authentication is the deployment's (for example a personal access token or OAuth); unauthenticated requests get `401` with `WWW-Authenticate`.
- Entity references are plain record ids in the input schema; the server maps them to handles and applies the entity `get` authorization (§5.5).
- Gated calls return a non-error result with `structuredContent: { status: 'needs_approval', grantId, approvalUrl, expiresAt }`, and the server lists a read-only `saydo_approval_status` tool. If any reversible capability is exposed, it also lists `saydo_undo`.
- Tool results never contain handler error text (§8.2).

## 11. Security considerations

| Threat | Mitigation in this spec |
|---|---|
| Prompt-injected model approves itself | Tiers on the server (§4); grants need a trusted gesture (§6.3.5) |
| Client lies about risk or descriptors | The server's own descriptors only (§4) |
| Forged history, approvals or handles | Sealed state (§9); grants stored server-side (§6.3.1) |
| Card shows something other than what runs | Server-built ConfirmView from the stored args (§6.4) |
| Hallucinated or IDOR ids | Opaque handles plus `get` authz on every use (§5.4, §5.5) |
| Exfiltration through URLs or images | Declared search params only (§5.3); internal navigate effects only (§3.4); UIs MUST NOT auto-load remote media from model output |
| Second-order injection through errors | Authored messages only (§8.2) |
| Replay or double execution | Atomic single-use grants; outcome replay (§6.3.2, §6.3.3) |
| Cost abuse of the planner endpoint | Same-origin only, per-user rate limits, output caps |
| No human present | Non-interactive policy (§6.5) |
| Tool poisoning through imported descriptions | Third-party labels and caps (§3.7); imported tools default to `destructive` (§3.1) |
| Running different code than the user approved | Version-pinned grants (§3.6), manifest hash (§9) |
| Conversation tampering or cross-user access | Sealed pointers bound to user and tab, ownership checked on load (§9.1) |

## 12. Accessibility considerations

- AI-driven navigation MUST be announced in a polite live region and SHOULD move focus to the page's primary heading when the assistant UI is closed.
- AI navigation SHOULD use history `push`, so that Back undoes it.
- The confirmation view MUST be fully operable by keyboard and screen reader.
- Every capability SHOULD have a human UI path. AI-only actions are a degradation and accessibility dead end.

## 13. Conformance tests

A conforming implementation passes the reference suite (`packages/*/test`) or an equivalent. It must cover:

- a scripted compromised planner that requests destructive actions on every step and produces zero executions without consent
- forged, cross-user and cross-tab state rejection
- replay and expiry of grants
- rejection of undeclared search params
- loop and step caps
- a "fix" string for every status
- RFC 8785 test vectors
- agents: hidden and `never` capabilities are not listed; delegated grants can be read and approved only by their own user, only with a trusted gesture, exactly once; expiry and denial are terminal
- grant stores: under concurrent approval of one grant, exactly one caller executes
- conversation stores: one winner among concurrent saves of one version; ordered append-only transcripts; erasure by user
- workflows: risk is never below the riskiest step; failed steps undo completed reversible steps in reverse

## 14. Versioning and extensibility

- The manifest carries `protocolVersion` (`"0.2"` for this draft). Versions are `major.minor`. Minor versions only add optional fields, request types, statuses or tools; a major version may change meaning.
- **Must-ignore.** Receivers MUST ignore object members they do not understand, in every message. Senders MUST NOT rely on a receiver understanding a member introduced after the version the receiver advertises.
- An unknown request `type` MUST be answered with `invalid_args`. A client that receives an unknown receipt `status` MUST treat it as `error` and show the `fix`.
- Implementation-specific members SHOULD be prefixed `x-` (for example `x-acme-trace`) and MUST NOT change the meaning of standard members, in particular tiers, grants and consent.
- Capabilities carry `version`. Grants record the capability version they were staged against; a grant MUST NOT execute against a different version (`reload_required`).
- Deprecated members stay valid for at least one minor version and are marked in the schema with `deprecated: true`.

## 15. Open issues

- Taint propagation: escalating tiers in turns that contain untrusted content.
- Manifest signing: not specified. The manifest is served same-origin over TLS by the server that also serves the code, so a signature adds no protection against the attacker who could alter it.
- Multi-tab election.
- MCP extension packaging for §6 (delegated approval as a standard elicitation profile).
- A second host implementation before v1.0. The reference repository now has a framework-free client (`saydo/dom`) that exercises the turn protocol without React; a second *server* implementation (another language or runtime) is still needed.
- Resolved since v0.1: durable grant stores (SQL compare-and-set and Redis Lua references, §6.3), the WebAuthn step-up profile (§6.6), request idempotency (§7.1), non-interactive callers (§6.5).
