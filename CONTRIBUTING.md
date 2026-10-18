# Contributing

Thanks for helping. A few things keep Saydo safe and its protocol open.

## Setup

```bash
pnpm install
pnpm typecheck && pnpm test   # Redis contract tests run when redis-server is installed
pnpm build                    # packages/saydo/dist
pnpm demo                     # Next.js example; pnpm demo:react for Vite + React Router
```

## Rules

- **Security first.** A change that could let an action run without consent, widen what the model sees, or weaken a default needs a test that fails without it. Report vulnerabilities privately (see [SECURITY.md](SECURITY.md)), not in issues.
- **Fails with a fix.** Every new error status or warning carries a `fix` string telling the developer what to do.
- **Protocol changes** follow the RFC process in [IP-POLICY.md](IP-POLICY.md), and so does anything that changes a message shape in [SPEC.md](SPEC.md).
- **Templates** are synced from the examples: edit `examples/*`, then run `pnpm templates`.
- Sign off your commits (`git commit -s`, [DCO](https://developercertificate.org/)).
