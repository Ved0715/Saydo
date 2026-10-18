# Agent instructions for the Saydo repository

This is the Saydo monorepo: the framework (`packages/saydo`, published as `saydo-js`), `create-saydo-app`, two example apps and the website.

- Read `CONTRIBUTING.md` before changing code. The short version for agents is `.claude/skills/saydo-contributing/SKILL.md`.
- Run `pnpm check` before calling a change done.
- Keep the safety rules in CONTRIBUTING.md ("Rules every change follows"). In particular, never let anything lower a declared risk, and never pass raw error text to the model.
- After changing `examples/`, run `pnpm templates`, and commit regenerated `saydo.capabilities.json` files.
- How to *use* Saydo in an app is documented for agents in `packages/saydo/skill/SKILL.md`.
