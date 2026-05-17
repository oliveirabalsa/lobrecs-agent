# AgentForge — Task Index

> Electron desktop app · AI coding agent harness · multi-model router · swarm orchestrator

## Como usar este backlog

Cada arquivo é uma tarefa auto-contida pensada para ser executada por **um único agente** sem depender de contexto externo.  
Cada tarefa tem: contexto, critérios de aceite (DoD), arquivos a criar/modificar, e comandos de validação.

Antes de iniciar qualquer tarefa, leia o arquivo `AGENTS.md` na raiz do repo (será criado na T-01).

---

## Milestones

| Milestone | Foco | Tarefas |
|-----------|------|---------|
| **M1** | Skeleton + Claude Code adapter | T-01 a T-06 |
| **M2** | Diff viewer + Codex adapter + histórico | T-07 a T-12 |
| **M3** | Model Router Engine | T-13 a T-16 |
| **M4** | Multi-tab + Swarm Orchestrator | T-17 a T-21 |
| **M5** | Polish + Cost dashboard + Beta | T-22 a T-26 |

---

## Mapa de dependências

```
T-01 (scaffold)
  └── T-02 (IPC bridge)
        ├── T-03 (ProjectStore)
        │     └── T-04 (ProjectSidebar UI)
        ├── T-05 (ProcessPool)
        │     └── T-06 (ClaudeCode adapter)
        │           └── T-07 (TerminalPanel)
        │                 └── T-08 (streaming parser)
        │                       ├── T-09 (DiffViewer)
        │                       │     └── T-10 (ApprovalFlow)
        │                       └── T-11 (Codex adapter)
        │                             └── T-12 (SessionHistory)
        └── T-13 (complexity scorer)
              └── T-14 (ModelRouter)
                    └── T-15 (router UI)
                          └── T-16 (feedback loop)
                                ├── T-17 (multi-tab manager)
                                │     └── T-18 (worktree isolation)
                                │           └── T-19 (SwarmOrchestrator)
                                │                 └── T-20 (SwarmBuilder UI)
                                │                       └── T-21 (result comparison)
                                └── T-22 (CostTracker)
                                      └── T-23 (CostDashboard UI)
T-24 (OpenCode/Minimax adapter)   [paralela após T-06]
T-25 (Automations engine)          [paralela após T-12]
T-26 (macOS sign + release)        [paralela após T-21]
```

---

## Tarefas disponíveis para agentes em paralelo

Após o M1 estar completo, estas tarefas podem rodar em paralelo sem conflito de arquivos:

- **T-11** (Codex adapter) + **T-24** (OpenCode adapter) — arquivos distintos
- **T-13** (complexity scorer) + **T-07** (TerminalPanel) — camadas distintas
- **T-22** (CostTracker) + **T-25** (Automations) — módulos independentes
- **T-26** (release config) — não toca em código de feature

---

## Stack de referência

```
Shell:        Electron 33+
UI:           React 19 + TypeScript
Styling:      Tailwind CSS v4 + Radix UI
Terminal:     xterm.js + node-pty
Diff editor:  Monaco Editor
DB:           SQLite (better-sqlite3)
IPC:          Electron contextBridge
Process mgmt: node:child_process + node-pty
Bundler:      Vite + electron-vite
Packaging:    electron-builder
```

---

## Convenções de código

- TypeScript strict mode em todos os arquivos
- Barrel exports (`index.ts`) por módulo
- Testes com Vitest; arquivos `*.test.ts` ao lado do fonte
- Commits no formato `feat(scope): description` / `fix(scope): description`
- Nunca armazenar API keys — usar env vars herdadas do shell do usuário
- Aprovação explícita antes de qualquer `git apply` ou escrita em disco
