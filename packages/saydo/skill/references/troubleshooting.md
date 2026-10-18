# Troubleshooting

Every Saydo error carries a `fix`. These are the common ones.

| Symptom or message | Cause | Fix |
|---|---|---|
| `SAYDO_SECRET is not set.` | Production without a secret. | Set `SAYDO_SECRET` to 32+ random characters (`openssl rand -hex 32`). |
| `No getUser is configured, so the assistant cannot tell users apart.` (`no_user`) | Production, data-changing actions, no `getUser`. | Set `getUser` to your auth, or `getUser: 'anonymous'` for a public app. |
| `No durable grant store is configured for gated capabilities.` | Production with confirmable actions and no store. | `store: postgresGrantStore(pool)` (or Redis or Firestore), or `store: 'memory'` for a single instance. |
| `No model configured.` | Production without `model`. | Set `model` to an AI SDK model. In dev the mock planner is used. |
| `saydo.capabilities.json is out of date` (build fails) | Actions or risks changed and the lockfile was not regenerated (`CI=true` checks it). | Run `npm run dev` or a local `npm run build`, review the diff, commit it. |
| `Capability safety changed (review saydo.capabilities.json in your PR)` | A risk was lowered or an action was exposed. | Intentional? Commit the lockfile. If not, restore the risk. |
| `The AI model is unavailable right now.` (`planner_unavailable`) | The provider failed, or the key is wrong or rate-limited. After repeated failures a 30-second circuit breaker answers fast. | Check the provider key in `.env.local`. Add a backup: `model: [primary, backup]`. |
| `Cross-site requests are not allowed.` (403) | The endpoint was called from another origin. | Call it from the same origin. The endpoint is same-origin by design. |
| `Expected application/json.` (415) | A request without a JSON content type. | Send `content-type: application/json`. |
| `Too many assistant requests.` / `Daily assistant limit reached.` | `limits.perMinute` or `limits.perDay`. | Raise the limits, or share counters across instances with `limits.store`. |
| `reload_required` | The app was deployed while the page was open, or an action's `version` changed after the card was shown. | Reload the page and ask again. |
| `precondition_failed` on approval | The record changed or was deleted after the card was shown (`entity.version`, or `get` returned nothing). | Ask again with the current data. |
| `mcp() needs the @ai-sdk/mcp package` | `mcp()` source without its peer dependency. | `npm install @ai-sdk/mcp`. |
| `Could not load tool source …` | An MCP server or OpenAPI spec could not be reached. | Check the URL and credentials. Its tools are unavailable until then. |
| The Permissions-Policy blocks WebMCP | `<SaydoProvider agents>` without the header change. | `withSaydo(config, { agents: true })` (Vite: `saydo({ agents: true })` and `serveStatic(dir, { agents: true })`). |
| `memoryThreadStore() keeps conversations in this process only` | Memory conversation store in production. | Use `firestoreThreadStore` or `postgresThreadStore`. |
| An action is never picked | Its `describe` is vague or overlaps another. Or it is hidden (`hide.actions`, `can`, `expose.assistant: false`), or it's a client action that is not mounted and has no `entry`. | `npx saydo inspect /page` lists exactly what the model gets. `npx saydo doctor` flags overlapping descriptions. |
| "I could not put that request together correctly" | The model sent invalid arguments twice. | Tighten `input` and its field names, and make `describe` say what each field means. |
| A dynamic page is never offered | Its params are not bound to entities. | `page({ params: { id: Post.param() } })` in that page's `nav.ts`. |
| Every click asks for confirmation | Unannotated clicks use `act.defaultRisk` (`'write'`). | Annotate safe elements with `data-saydo-risk="read"`, or lower `act.defaultRisk` deliberately. |
| A reversible action asks for confirmation | The request read untrusted content (taint), or a policy raised it. | Intended. `act: { taint: 'off' }` relies on Undo alone. |

Still stuck: `npx saydo doctor`, then the full docs at `node_modules/saydo-js/README.md` or https://github.com/Ved0715/Saydo#readme.
