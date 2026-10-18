# Security policy

Saydo sits on the write path of the apps that use it, so we treat any way to make an action run without the user's consent, read data the developer marked private, or act as another user as a critical vulnerability.

## Reporting a vulnerability

Please **do not** open a public issue. Email the maintainers (see the package `author` field once published) with:

- a description and impact
- steps or a proof of concept (a failing test against `mockPlanner({ script })` is ideal)
- the affected version

We aim to acknowledge reports within 72 hours and to ship a fix for critical issues within 14 days, coordinating disclosure with you.

## What counts

- Executing a `write`, `destructive` or `never` action, or an unannotated page click, without a trusted approval.
- Approving with forged, replayed, expired or another user's grants.
- Tampering with sealed thread state, or resolving another user's entity handles.
- Content inside `data-saydo-private` reaching the model, or masked fields (passwords, payment, one-time codes) leaking.
- Prompt injection that bypasses the consent gate (the gate must hold even when the model is fully compromised).
- Exfiltration through navigation, URL parameters, or rendered model output.

## Hardening checklist for apps

- Set `SAYDO_SECRET` (32+ random chars) and use a durable `store` (for example `postgresGrantStore`) when running more than one instance.
- Implement `getUser`, and check authorization inside every handler and Server Action.
- Wrap user-generated content in `data-saydo-untrusted`; consider `act.annotationsCanLowerRisk: false` if you render rich user HTML.
- Mark sensitive regions `data-saydo-private`; keep `redact` on (default `'basic'`), or use `'strict'`.
- Commit `saydo.capabilities.json` and build with `CI=true`, so lowered risks fail review.
- Use `createAuditLog` for a tamper-evident trail.

## Releases

Releases are published with npm provenance from CI (`npm publish --provenance`).
