# Project Memory

Lobrecs Agent stores project-specific learned guidance in the target repository
at `.lobrecs/memory.json`. This file is intentionally repo-local so the same
project carries its rules, preferences, and lessons across future sessions.

## Behavior

- Positive or partial session feedback with a note is saved as learned workflow
  knowledge.
- Manual memory entries can be saved through the `memory:*` IPC/preload API.
- Future agent dispatches receive the memory block before same-thread history.
- Memory is not stored in SQLite and must not contain API keys, tokens, or
  credentials.

## File Shape

```json
{
  "version": 1,
  "entries": [
    {
      "id": "uuid",
      "kind": "architecture",
      "summary": "Keep privileged filesystem access in the main process.",
      "details": "Renderer modules must use window.agentforge.",
      "source": "manual",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ]
}
```

Supported `kind` values are `architecture`, `workflow`, `preference`,
`failure`, and `general`.
