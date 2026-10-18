<!-- BEGIN:saydo-agent-rules -->
## Saydo (the in-app AI assistant)

This app uses Saydo (npm: `saydo-js`). Before changing anything about the assistant (`saydo.config.ts`, `capabilities/`, `entities/`, `nav.ts` files, `<SaydoProvider>`), read `.claude/skills/saydo/SKILL.md` and its `references/`.

- Declare each action's risk honestly (`read`, `reversible` + `undo`, `write`, `destructive`, `never`). Never lower it to skip a confirmation.
- Files with handlers, entities or database code start with `import 'server-only';`.
- Keep data from the model with `hide` in saydo.config.ts or `data-saydo-private`, never with prompts.
- Commit `saydo.capabilities.json`; `CI=true npm run build` fails when it is stale.
- Check changes with `npx saydo doctor` and `npx saydo inspect <path>`.
<!-- END:saydo-agent-rules -->
