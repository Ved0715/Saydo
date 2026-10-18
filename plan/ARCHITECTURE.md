# Saydo architecture: the assistant can do anything the user can do, as far as the developer allows

## 1. What "Actions are declared" and "Safety is structural" mean (plain words)

- **Actions are declared.** The developer writes a short description of an action once: what it is called, what input it takes, how risky it is, and the function that does it. ai-nav does everything else. It tells the model the action exists, asks the user to confirm when needed, offers Undo, reports results back to the model, and retries safely. The developer never writes prompts, tool schemas, or confirm dialogs.
- **Safety is structural.** The AI cannot talk its way past the safety checks, because the checks are code on the server, not instructions in a prompt:
  - The server alone decides how risky each action is.
  - A risky action waits for the user's click on a card that shows exactly what will happen.
  - Each approval works once, for those exact arguments.
  - Even if a web page tricks the model ("ignore your rules and delete everything"), the model can only *ask*. Nothing dangerous runs until the user clicks.

## 2. The goal

The assistant should be able to **see**, **do**, and **go** across *every* surface of the app, limited only by two things:

1. **What the developer allows.** One config file and the lockfile record exactly what is exposed.
2. **What the signed-in user could do anyway.** The assistant acts *as the user, through the app's own doors*, never with more permission.

Consequential steps still need the user's consent. That is the one thing that is not negotiable.

## 3. Every place an app's abilities live, and how ai-nav reaches each

| # | Surface | How ai-nav reaches it | Developer effort | Default risk | Status |
|---|---|---|---|---|---|
| 1 | **Pages** | Derived from `app/` (Next) or `ai-nav.routes.ts` (React) | none | read | ✅ built |
| 2 | **URL state** (filters, tabs, sort) | `search` schema in `nav.ts` | 1 line | read | ✅ built |
| 3 | **What is on screen** (text, tables, form values) | **Page snapshot**: a compact, visible-only outline of the current page, sent as untrusted context | none (on by default) | read | ✅ built |
| 4 | **App data** | Entities (`find` / `get`) and `read` capabilities | 1 declaration per model | read | ✅ built |
| 5 | **Component state** | `useAINavContext(key, value)` | 1 line | read | ✅ built |
| 6 | **UI interactions** (dialogs, tabs, theme) | `useAction(id, describe, fn)` | 1 line | read (tier 0) | ✅ built |
| 7 | **Buttons and links** | Any visible element is operable by default (`page_act`); `data-saydo`, `data-saydo-risk` and `data-saydo="off"` refine it | none | unannotated clicks: `write` (confirm) | ✅ built |
| 8 | **Forms** | Fill and select freely (tier 0); submit per risk, with the card listing the values to be sent; WebMCP `toolname` honored | none | fill: read · submit: `write` unless marked | ✅ built |
| 9 | **Server Actions** (`'use server'`) | `serverAction({ describe, input, risk }, fn)`: one function for UI (object or FormData) and assistant, auto-discovered | 1 wrapper | destructive unless marked | ✅ built |
| 10 | **Server mutations** | `defineCapability` with handler | 1 declaration | destructive unless marked | ✅ built |
| 11 | **Existing REST / route handlers** | `useCapability` + `withGrant` | 2 lines | per risk | ✅ built |
| 12 | **OpenAPI / tRPC** | `fromOpenAPI(spec, { include })` / `fromTRPC(router, { caller })` | 1 line per API | destructive; GET/queries opt into read | ✅ built |
| 13 | **External tools** (MCP servers, AI SDK tools) | `tools: [mcp({ url, risk })]`, `aiTools({...})` in config | 1 line | destructive unless mapped; MCP hints never lower it | ✅ built |
| 14 | **Client stores** (Zustand / Redux) | `exposeStore(store, { actions })` | 1 call | per action | later |
| 15 | **Other agents using your app** (browser agents, MCP clients) | Emission to WebMCP and an MCP server | config flag | refuses tier ≥ 2 without a human | planned (M6) |

The rule that makes this safe *and* seamless: **everything is available by default, the developer restricts what they want, and risk is never guessed.** Declared actions default to `destructive`; un-annotated clicks default to `write`. Both mean the user confirms. Marking something `read` or `reversible` removes the friction, and that change shows up in the lockfile diff.

## 4. One pipeline for all of it

```mermaid
flowchart LR
  subgraph Sources
    R[Pages + URL state]
    P[Page snapshot]
    E[Entities + reads]
    U[useAction / buttons / forms]
    S[defineCapability / Server Actions]
    A[OpenAPI / tRPC / REST]
    T[MCP + AI SDK tools]
  end
  Sources --> N[Normalize to Capability<br/>id · describe · input · risk · where it runs]
  N --> L[Allow policy + lockfile]
  L --> Pol[Server policy: risk → tier]
  Pol --> Sur[Tool surface for this user + page<br/>auto-surfacing / tool search at scale]
  Sur --> M[Model proposes calls]
  M --> G{Tier}
  G -->|0 read / UI| X[Execute]
  G -->|1 reversible| XU[Execute + Undo]
  G -->|2-3 consequential| C[Confirm card from real args<br/>trusted click, single-use grant]
  C --> X
  G -->|4 never| D[Refuse; link to the page]
  X --> W{Runs where?}
  W --> WS[Server: handler, Server Action, API, MCP]
  W --> WC[Browser: component handler, button click, form fill]
  WS --> Rc[Receipt]
  WC --> Rc
  Rc --> M
```

Every surface becomes the same normalized **Capability**, so policy, consent, receipts, the lockfile, testing, and emission are written once and apply everywhere.

**Execution locations.** This is the only part that differs per source:

| Runs on | Sources | How |
|---|---|---|
| Server | `defineCapability`, Server Actions, OpenAPI/tRPC, MCP tools | Engine calls it directly. Grants are verified in the same process. |
| Browser, component | `useAction`, `useCapability` | Dispatch to the mounted handler (built). |
| Browser, DOM | `data-ai` buttons and forms | Dispatch to a registry of annotated elements. ai-nav fills inputs with native events and clicks the real element. Submission goes through the app's own handlers. |

## 5. "Whatever the developer allows": one place to see and control it

```ts
// saydo.config.ts
export default defineConfig({
  model: anthropic('claude-sonnet-5-5'),
  getUser,
  see: { page: true },                            // read the visible page (default)
  act: { elements: 'all', defaultRisk: 'write' }, // operate any element; unannotated clicks confirm (default)
  tools: [mcp({ url: 'https://mcp.example.com/mcp', risk: { search: 'read' } }), fromOpenAPI('./openapi.json', { include: ['listInvoices'] })],
});
```

- **Per element:** `data-saydo-private`, `data-saydo="off"`, `data-saydo-risk`, `data-saydo-untrusted`, `data-saydo-context`.
- **Per action:** `risk`, `can(user)`, `expose`.
- **Per page:** `access`, `hidden`.
- `saydo.capabilities.json` lists every exposed action, its risk, every page and every tool source. Changes show up in pull-request diffs, and CI fails if the file is stale.
- `saydo actions` prints it, `saydo inspect /page` shows the tools for a page, and `saydo ask "…"` shows what the model would do without approving anything.

## 6. Information access, without leaking

- **Page snapshot** (on by default):
  - Only visible content is included: headings, text, table rows, lists, links, and form fields with labels and values.
  - It is excluded: password, payment and one-time-code values, hidden elements, `[data-saydo-private]` subtrees, and the assistant UI.
  - It is budgeted (12 KB by default), and always wrapped as `<untrusted>` data.
- **User content:** `[data-saydo-untrusted]` regions are marked as user-written, and their elements are never operable. Injected buttons cannot become actions.
- **Entities and reads** cover data that is not on screen.
- **Privacy:** the snapshot goes to the model provider. Mark sensitive regions `data-saydo-private`, or set `see: { page: false }`.

## 7. Clicking any button, safely

By the user's choice ("full freedom"), every visible element is operable by default. Safety comes from the server deciding risk:

| Element action | Risk |
|---|---|
| Typing and choosing | free; it is local, visible and editable |
| Checkboxes inside forms | free |
| Internal links | free |
| Everything else | `act.defaultRisk`: `write`, so the user confirms |

- The confirm card names the element and its row, and for submits the exact values that will be sent.
- Developers remove friction by annotating safe elements `data-saydo-risk="read"`, mark dangerous ones `destructive` or `never`, switch to `act.elements: 'annotated'`, or turn element control off.

## 8. What makes it feel seamless

- **Zero-config start.** Every page is navigable, and plain navigation is answered instantly without a model call (built).
- **Cross-page plans.** "Publish my Roadmap post" from any page: server actions run anywhere; UI and element actions open their page first and wait until ready (built for capabilities; extended to `data-ai` elements).
- **Scale.** Small apps send every tool. Large apps send the page's tools in full, plus a `find_capability` meta-tool for the rest (tool search), so hundreds of actions do not flood the prompt.
- **Visible work.** Forms fill as a visible draft the user can edit before submitting. Every step shows a receipt line. Undo appears for reversible steps.
- **The same UI everywhere.** ⌘K palette and confirm card by default. Headless hooks for custom UIs.

## 9. Status

Built and verified (90 tests, plus real installs of both templates from packed tarballs):

- steps A (page snapshot) through E (OpenAPI/tRPC)
- F (tool search)
- G (CLI, `create-saydo-app`, dev inspector)
- H (Vite + React Router)

Remaining:

- durable approval stores
- voice
- WebMCP / MCP emission
- streaming
- more router hosts
