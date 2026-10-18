# create-saydo-app

Create an AI-native React or Next.js app with [Saydo](https://www.npmjs.com/package/saydo). Say it. It's done.

```bash
npx create-saydo-app my-app                   # Next.js App Router (default)
npx create-saydo-app my-app --template vite   # React + Vite + React Router
```

Options: `--template next|vite`, `--pm npm|pnpm|yarn|bun`, `--install`, `--yes`.

Then `cd my-app && npm run dev`, open the app and press **⌘K**. It works without an API key (deterministic mock planner); add `ANTHROPIC_API_KEY` (or any AI SDK provider) for a real model.
