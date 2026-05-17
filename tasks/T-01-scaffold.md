# T-01 · Project Scaffold

**Milestone:** M1  
**Depende de:** nenhuma  
**Pode rodar em paralelo com:** nenhuma (é a primeira)  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet / codex  

---

## Contexto

Criar a estrutura base do projeto Electron + React + TypeScript usando `electron-vite`.  
Resultado: um app que abre uma janela, renderiza "AgentForge" e fecha sem erros.

---

## O que fazer

### 1. Criar o projeto base

```bash
npm create electron-vite@latest agentforge -- --template react-ts
cd agentforge
npm install
```

### 2. Instalar dependências base

```bash
npm install better-sqlite3 @types/better-sqlite3
npm install xterm xterm-addon-fit xterm-addon-web-links
npm install node-pty
npm install @monaco-editor/react
npm install @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-tooltip
npm install tailwindcss @tailwindcss/vite
npm install date-fns
npm install -D vitest @vitest/ui
```

### 3. Estrutura de pastas a criar

```
agentforge/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # entry point
│   │   ├── ipc/               # IPC handlers
│   │   ├── agents/            # Agent adapters
│   │   ├── router/            # Model router engine
│   │   ├── swarm/             # Swarm orchestrator
│   │   ├── store/             # SQLite store
│   │   └── process/           # ProcessPool
│   ├── preload/
│   │   └── index.ts           # contextBridge API
│   └── renderer/              # React UI
│       ├── main.tsx
│       ├── App.tsx
│       └── components/
├── AGENTS.md                  # contexto para agentes de coding
├── .env.example
└── electron-builder.yml
```

### 4. Criar o arquivo `AGENTS.md` na raiz

```markdown
# AGENTS.md — AgentForge

## O que é este projeto
Electron desktop app que serve como harness para múltiplos agentes de AI coding
(Claude Code, Codex CLI, OpenCode). Seleciona modelo por complexidade e orquestra swarms.

## Stack
- Electron 33+ com contextIsolation: true
- React 19 + TypeScript strict
- Tailwind CSS v4
- SQLite (better-sqlite3) para persistência local
- xterm.js + node-pty para terminal emulado
- Monaco Editor para diff view

## Regras críticas
- NUNCA armazenar API keys no código ou banco
- Todo acesso a Node.js do renderer DEVE passar pelo contextBridge (preload/index.ts)
- Aprovar explicitamente antes de aplicar qualquer diff em disco
- Commits: `feat(scope): msg` ou `fix(scope): msg`

## Rodar o projeto
- `npm run dev` — inicia em modo desenvolvimento
- `npm test` — roda Vitest
- `npm run build` — build de produção

## Convenções
- Barrel exports: cada pasta tem index.ts
- Testes ao lado do fonte: `foo.test.ts`
- Tipos compartilhados em `src/shared/types.ts`
```

### 5. Configurar Tailwind v4

Em `src/renderer/main.css`:
```css
@import "tailwindcss";
```

Em `vite.config.ts` (renderer):
```ts
import tailwindcss from '@tailwindcss/vite'
// adicionar ao array plugins
```

### 6. Configurar Vitest

Em `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

### 7. Criar tipos compartilhados

Criar `src/shared/types.ts` com interfaces base:

```ts
export type AgentId = 'claude-code' | 'codex' | 'opencode' | 'cursor'

export type ModelTier = 'lightweight' | 'balanced' | 'advanced' | 'frontier'

export interface Project {
  id: string
  name: string
  repoPath: string
  agentId: AgentId
  modelTier: ModelTier
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  projectId: string
  agentId: AgentId
  model: string
  prompt: string
  status: 'running' | 'awaiting-approval' | 'done' | 'error' | 'cancelled'
  tokensIn: number
  tokensOut: number
  costUsd: number
  createdAt: number
  completedAt?: number
}

export interface AgentEvent {
  type: 'stdout' | 'stderr' | 'approval-request' | 'diff' | 'session-complete' | 'error'
  sessionId: string
  payload: unknown
  timestamp: number
}
```

---

## Critérios de aceite (DoD)

- [ ] `npm run dev` abre janela Electron sem erros no console
- [ ] `npm test` roda (mesmo sem testes ainda, só deve passar com 0 testes)
- [ ] Estrutura de pastas existe conforme especificado acima
- [ ] `AGENTS.md` existe na raiz com conteúdo
- [ ] `src/shared/types.ts` exporta todas as interfaces
- [ ] TypeScript compila sem erros (`npx tsc --noEmit`)
- [ ] `.env.example` existe com variáveis documentadas (sem valores reais)

---

## Validação

```bash
npm run dev          # deve abrir janela
npx tsc --noEmit     # zero erros
npm test             # passa (0 tests)
ls src/main src/preload src/renderer src/shared   # pastas existem
cat AGENTS.md        # arquivo tem conteúdo
```
