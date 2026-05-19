# Lobrecs Agent Docs

These docs define how humans and AI agents should change this codebase. Read
the relevant guide before editing code, reviewing changes, or planning a
refactor.

## Start Here

- [Modular architecture](architecture/modular-architecture.md) defines the
  target structure for the app and the migration rules for future refactors.
- [Clean code](best-practices/clean-code.md) defines implementation standards
  for TypeScript, Electron, React, persistence, IPC, and tests.
- [Clean review](best-practices/clean-review.md) defines how to review changes
  with a focus on bugs, regressions, security, and missing verification.
- [Settings](features/settings.md) documents configurable app behavior and the
  values that are intentionally excluded from persistence.

## Agent Skills

Use the project skill files in `.skills/` when prompting AI coding agents in
this repo:

- [Clean code skill](../.skills/clean-code/SKILL.md) is the execution checklist
  for implementation agents.
- [Clean review skill](../.skills/clean-review/SKILL.md) is the execution
  checklist for review agents.

## Documentation Rules

- Keep docs close to the actual architecture. Update these files when the
  refactor changes the intended boundaries.
- Prefer concrete rules and examples over vague principles.
- Do not document secrets, private tokens, local API keys, or machine-specific
  credentials.
