# Settings

Settings are a vertical feature: shared contracts, SQLite persistence, main
application service, IPC handlers, preload bridge, and renderer workspace.

## Scope

The app stores:

- agent enablement, command overrides, permission modes, and model tier maps
- model-routing thresholds, security minimum tier, and failure escalation
- execution defaults including worktree isolation, queue limit, and command
  prefix warnings
- swarm strategy, templates, max agents, and reviewer iterations
- spec defaults and verification recipes
- cost pricing overrides and workspace UI/editor defaults
- whether packaged builds should check for app updates on launch

Project overrides are saved separately from global settings and are merged over
global defaults when a project-specific action runs.

## Exclusions

Never store provider API keys, access tokens, private credentials, or local auth
material in settings. Agent CLIs should keep using their own external auth or
environment variables.

## Runtime Use

New sessions, swarms, routing previews, verification recipes, image limits, and
cost estimates read effective settings at execution time. Existing running
sessions continue with the configuration they were launched with.
