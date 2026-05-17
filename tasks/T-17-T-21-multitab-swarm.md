# T-17 · Multi-Tab Session Manager UI

**Milestone:** M4  
**Depende de:** T-07, T-08  
**Pode rodar em paralelo com:** T-22 (CostTracker), T-24 (OpenCode adapter)  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Múltiplas sessions ativas em paralelo, cada uma em sua própria tab.  
Modelo similar ao Codex app: threads como conceito central da UI.

---

## O que fazer

### 1. Criar `src/renderer/store/tabs.ts` (estado global com React Context)

```ts
import { createContext, useContext, useReducer } from 'react'

export interface Tab {
  sessionId: string
  projectId: string
  prompt: string
  status: 'running' | 'awaiting-approval' | 'done' | 'error' | 'cancelled'
  model: string
  tier: string
  createdAt: number
}

type TabsState = {
  tabs: Tab[]
  activeTabId: string | null
}

type TabsAction =
  | { type: 'ADD_TAB'; tab: Tab }
  | { type: 'SET_ACTIVE'; sessionId: string }
  | { type: 'UPDATE_STATUS'; sessionId: string; status: Tab['status'] }
  | { type: 'CLOSE_TAB'; sessionId: string }

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'ADD_TAB':
      return { tabs: [...state.tabs, action.tab], activeTabId: action.tab.sessionId }
    case 'SET_ACTIVE':
      return { ...state, activeTabId: action.sessionId }
    case 'UPDATE_STATUS':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.sessionId === action.sessionId ? { ...t, status: action.status } : t
        ),
      }
    case 'CLOSE_TAB': {
      const remaining = state.tabs.filter(t => t.sessionId !== action.sessionId)
      return {
        tabs: remaining,
        activeTabId: remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null,
      }
    }
  }
}
```

### 2. Criar `src/renderer/components/TabBar/index.tsx`

```tsx
interface Props {
  tabs: Tab[]
  activeTabId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
}

// Tab visual:
// [● running]  [✓ done]  [✗ error]
// Prompt truncado + modelo badge
// X para fechar (apenas se done/error/cancelled)
// ⌘T para nova tab

const STATUS_COLORS = {
  running:            'text-blue-400',
  'awaiting-approval': 'text-amber-400',
  done:               'text-green-400',
  error:              'text-red-400',
  cancelled:          'text-zinc-500',
}

const STATUS_ICONS = {
  running:            '●',
  'awaiting-approval': '⚡',
  done:               '✓',
  error:              '✗',
  cancelled:          '○',
}
```

### 3. Criar `src/renderer/components/SplitView/index.tsx`

Permite ver 2 sessions lado a lado (útil para comparar resultados de swarm):

```tsx
interface Props {
  primarySessionId: string | null
  secondarySessionId: string | null
  onSwap: () => void
}
// Duas colunas iguais, cada uma com TerminalPanel
// Toggle button no header para alternar entre split e single view
```

### 4. Atalhos de teclado

```ts
// Registrar no Electron main ou via keydown no renderer:
// ⌘T       → nova tab / nova task
// ⌘W       → fechar tab ativa (se done/cancelled)
// ⌘1..⌘9  → selecionar tab por índice
// ⌘⇧X     → kill all (já registrado no T-10)
```

---

## Critérios de aceite (DoD)

- [ ] TabBar renderiza todas as sessions ativas com status correto
- [ ] Clicar em tab ativa aquela session no TerminalPanel
- [ ] Fechar tab cancela session se status `running` (com confirmação)
- [ ] `⌘T` foca o TaskInput para nova task
- [ ] `⌘1–⌘9` seleciona tabs por posição
- [ ] SplitView funciona com 2 sessions simultâneas
- [ ] Status atualiza em tempo real (via eventos IPC)
- [ ] TypeScript sem erros

---
---

# T-18 · Git Worktree Isolation

**Milestone:** M4  
**Depende de:** T-05 (ProcessPool)  
**Pode rodar em paralelo com:** T-17  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet / codex  

---

## Contexto

Quando múltiplos agentes rodam no mesmo repo, precisam de git worktrees isolados para evitar conflitos.  
Cada session de swarm cria seu próprio worktree temporário.

---

## O que fazer

### 1. Criar `src/main/git/WorktreeManager.ts`

```ts
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const execAsync = promisify(exec)

export class WorktreeManager {
  private worktrees = new Map<string, string>()  // sessionId → worktreePath

  async create(sessionId: string, repoPath: string): Promise<string> {
    const branch = `agentforge/${sessionId.slice(0, 8)}`
    const worktreePath = path.join(os.tmpdir(), `agentforge-${sessionId.slice(0, 8)}`)

    await execAsync(
      `git worktree add -b ${branch} ${worktreePath}`,
      { cwd: repoPath }
    )

    this.worktrees.set(sessionId, worktreePath)
    return worktreePath
  }

  async remove(sessionId: string, repoPath: string): Promise<void> {
    const worktreePath = this.worktrees.get(sessionId)
    if (!worktreePath) return

    try {
      await execAsync(`git worktree remove --force ${worktreePath}`, { cwd: repoPath })
    } catch {
      // Se falhar, tenta remover manualmente
      await fs.rm(worktreePath, { recursive: true, force: true })
    }

    // Remover branch temporária
    const branch = `agentforge/${sessionId.slice(0, 8)}`
    try {
      await execAsync(`git branch -D ${branch}`, { cwd: repoPath })
    } catch { /* ignore */ }

    this.worktrees.delete(sessionId)
  }

  getPath(sessionId: string): string | undefined {
    return this.worktrees.get(sessionId)
  }

  async removeAll(repoPath: string): Promise<void> {
    for (const sessionId of this.worktrees.keys()) {
      await this.remove(sessionId, repoPath)
    }
  }
}

export const worktreeManager = new WorktreeManager()
```

### 2. Testes

```ts
// src/main/git/WorktreeManager.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { WorktreeManager } from './WorktreeManager'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('WorktreeManager', () => {
  let repoPath: string
  const mgr = new WorktreeManager()

  beforeEach(() => {
    // Criar repo git temporário para testes
    repoPath = mkdtempSync(path.join(tmpdir(), 'agentforge-test-'))
    execSync('git init && git commit --allow-empty -m "init"', { cwd: repoPath })
  })

  it('creates and removes a worktree', async () => {
    const worktreePath = await mgr.create('session-123', repoPath)
    expect(worktreePath).toBeTruthy()
    expect(mgr.getPath('session-123')).toBe(worktreePath)

    await mgr.remove('session-123', repoPath)
    expect(mgr.getPath('session-123')).toBeUndefined()
  })
})
```

### 3. Integrar no SwarmOrchestrator (T-19)

O SwarmOrchestrator vai usar `worktreeManager.create()` antes de spawnar cada agente da swarm,  
e `worktreeManager.remove()` após consolidar os resultados.

---

## Critérios de aceite (DoD)

- [ ] `create()` executa `git worktree add` com branch única
- [ ] Retorna path do worktree criado
- [ ] `remove()` limpa worktree e branch
- [ ] `removeAll()` limpa todos os worktrees de um repo
- [ ] Funciona com repos sem commits (erro tratado graciosamente)
- [ ] Testes passam (requer git instalado no ambiente)
- [ ] TypeScript sem erros

---
---

# T-19 · SwarmOrchestrator

**Milestone:** M4  
**Depende de:** T-18, T-08  
**Pode rodar em paralelo com:** T-17  
**Estimativa:** 4–5h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Orquestra múltiplos agentes numa swarm. Suporta estratégias parallel, sequential e fan-out.  
Cada agente roda em worktree isolado para evitar conflitos de arquivos.

---

## O que fazer

### 1. Adicionar tipos em `src/shared/types.ts`

```ts
export interface SwarmConfig {
  projectId: string
  prompt: string
  strategy: 'parallel' | 'sequential' | 'fan-out'
  agents: SwarmAgentConfig[]
}

export interface SwarmAgentConfig {
  role: string              // ex: 'analyzer', 'implementer', 'reviewer'
  agentId: string
  modelOverride?: string
  promptSuffix?: string     // prompt adicional para este agente específico
}

export interface SwarmResult {
  swarmId: string
  strategy: string
  sessions: Array<{
    sessionId: string
    role: string
    worktreePath: string
    status: string
  }>
  consolidatedAt?: number
}
```

### 2. Criar `src/main/swarm/SwarmOrchestrator.ts`

```ts
import { randomUUID } from 'node:crypto'
import { worktreeManager } from '../git/WorktreeManager'
import { sessionManager } from '../session/SessionManager'
import { modelRouter } from '../router/ModelRouter'
import { projectsStore } from '../store'
import type { SwarmConfig, SwarmResult } from '../../shared/types'

export class SwarmOrchestrator {
  private swarms = new Map<string, SwarmResult>()

  async spawn(config: SwarmConfig): Promise<SwarmResult> {
    const swarmId = randomUUID()
    const project = projectsStore.get(config.projectId)
    if (!project) throw new Error('Project not found')

    const result: SwarmResult = {
      swarmId,
      strategy: config.strategy,
      sessions: [],
    }

    if (config.strategy === 'parallel') {
      await this.spawnParallel(config, project.repoPath, result)
    } else if (config.strategy === 'sequential') {
      await this.spawnSequential(config, project.repoPath, result)
    } else if (config.strategy === 'fan-out') {
      await this.spawnFanOut(config, project.repoPath, result)
    }

    this.swarms.set(swarmId, result)
    return result
  }

  private async spawnParallel(config: SwarmConfig, repoPath: string, result: SwarmResult) {
    // Spawnar todos os agentes em paralelo, cada um em seu worktree
    await Promise.all(config.agents.map(async (agentConfig) => {
      const sessionId = randomUUID()
      const worktreePath = await worktreeManager.create(sessionId, repoPath)

      const decision = await modelRouter.route({
        prompt: config.prompt,
        preferredAgentId: agentConfig.agentId,
        modelOverride: agentConfig.modelOverride,
      })

      await sessionManager.dispatch({
        projectId: config.projectId,
        prompt: `[Role: ${agentConfig.role}]\n${config.prompt}${agentConfig.promptSuffix ? '\n' + agentConfig.promptSuffix : ''}`,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: worktreePath,
      })

      result.sessions.push({
        sessionId,
        role: agentConfig.role,
        worktreePath,
        status: 'running',
      })
    }))
  }

  private async spawnSequential(config: SwarmConfig, repoPath: string, result: SwarmResult) {
    // Agentes rodam em sequência — output de um alimenta o próximo
    let previousOutput = ''

    for (const agentConfig of config.agents) {
      const sessionId = randomUUID()
      const worktreePath = await worktreeManager.create(sessionId, repoPath)

      const prompt = previousOutput
        ? `${config.prompt}\n\nContext from previous step:\n${previousOutput}\n\nYour role: ${agentConfig.role}`
        : `[Role: ${agentConfig.role}]\n${config.prompt}`

      const decision = await modelRouter.route({
        prompt,
        preferredAgentId: agentConfig.agentId,
      })

      // Para sequential, aguarda completar antes de próximo
      // TODO: implementar await de session completion
      await sessionManager.dispatch({
        projectId: config.projectId,
        prompt,
        agentId: decision.agentId,
        model: decision.model,
        repoPath: worktreePath,
      })

      result.sessions.push({ sessionId, role: agentConfig.role, worktreePath, status: 'running' })
    }
  }

  private async spawnFanOut(config: SwarmConfig, repoPath: string, result: SwarmResult) {
    // Orchestrator (primeiro agente) divide a task e spawna os demais
    // Por ora, similar ao parallel — orchestrator sofisticado é v2
    await this.spawnParallel(config, repoPath, result)
  }

  cancel(swarmId: string) {
    const swarm = this.swarms.get(swarmId)
    if (!swarm) return
    for (const s of swarm.sessions) {
      sessionManager.cancel(s.sessionId)
    }
    this.swarms.delete(swarmId)
  }

  get(swarmId: string): SwarmResult | undefined {
    return this.swarms.get(swarmId)
  }
}

export const swarmOrchestrator = new SwarmOrchestrator()
```

### 3. Conectar handlers IPC

Em `src/main/ipc/index.ts`, substituir stubs:
```ts
import { swarmOrchestrator } from '../swarm/SwarmOrchestrator'

ipcMain.handle('swarm:spawn', async (_, config) => swarmOrchestrator.spawn(config))
ipcMain.handle('swarm:status', async (_, swarmId) => swarmOrchestrator.get(swarmId))
ipcMain.handle('swarm:cancel', async (_, swarmId) => swarmOrchestrator.cancel(swarmId))
```

---

## Critérios de aceite (DoD)

- [ ] `spawnParallel` cria worktree por agente e spawna todos em paralelo
- [ ] `spawnSequential` cria agentes em série
- [ ] `cancel()` encerra todos os agentes do swarm
- [ ] Cada session aparece na TabBar como thread separada
- [ ] Worktrees são criados em `os.tmpdir()` com path único
- [ ] TypeScript sem erros

---
---

# T-20 · SwarmBuilder UI

**Milestone:** M4  
**Depende de:** T-17, T-19  
**Pode rodar em paralelo com:** T-21  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Interface visual para configurar e disparar swarms.  
Acessível via `⌘⇧S` ou botão na TaskInput.

---

## O que fazer

### 1. Criar `src/renderer/components/SwarmBuilder/index.tsx`

Modal/panel com:

**Header:**
- Título "Swarm Builder"
- Estratégia: radio buttons `parallel | sequential | fan-out`

**Prompt:**
- Mesma textarea do TaskInput (compartilhado ou copiado)

**Agent list:**
- Lista de agentes configurados
- Cada agente: Role name (editável) + Agente select + Model override (opcional) + Prompt suffix
- Botão "+ Add agent" (max 8)
- Botão delete por agente

**Templates pré-definidos:**
- "Security + Quality Review" → 2 agentes: security analyzer + code quality
- "Plan → Implement → Review" → 3 agentes sequenciais
- "Multi-approach" → 3 agentes parallel com mesmo prompt

**Footer:**
- Estimativa de custo ("~$0.01 – $0.05")
- Botão "Cancel" e "Launch Swarm ⌘⇧Enter"

### 2. Criar `src/renderer/components/SwarmBuilder/AgentRow.tsx`

```tsx
interface Props {
  index: number
  config: SwarmAgentConfig
  onChange: (config: SwarmAgentConfig) => void
  onRemove: () => void
  installedAgents: string[]
}
```

### 3. Handler de submit

```tsx
async function handleLaunch() {
  if (agents.length === 0 || !prompt.trim()) return
  setLaunching(true)
  try {
    const { swarmId } = await window.agentforge.swarm.spawn({
      projectId,
      prompt,
      strategy,
      agents,
    })
    onSwarmStarted(swarmId)
    onClose()
  } finally {
    setLaunching(false)
  }
}
```

---

## Critérios de aceite (DoD)

- [ ] Modal abre via `⌘⇧S`
- [ ] Seleção de estratégia muda layout (sequential mostra setas entre agentes)
- [ ] Templates pré-definidos pré-populam a lista de agentes
- [ ] Estimativa de custo baseada nos modelos selecionados
- [ ] Limit de 8 agentes ("+Add" desabilitado ao atingir)
- [ ] Ao lançar, cada agente aparece como tab separada na TabBar
- [ ] TypeScript sem erros

---
---

# T-21 · Result Comparison UI

**Milestone:** M4  
**Depende de:** T-20  
**Pode rodar em paralelo com:** T-22  
**Estimativa:** 3h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Após uma swarm paralela completar, exibir os resultados de cada agente lado a lado  
para que o usuário escolha qual (ou quais) aceitar.

---

## O que fazer

### 1. Criar `src/renderer/components/SwarmResults/index.tsx`

```tsx
interface Props {
  swarmId: string
  sessions: SwarmSessionSummary[]
  onAccept: (sessionId: string) => void
  onMerge: (sessionIds: string[]) => void
}
```

Layout:
- Grid de cards (1 por agente), máximo 3 por linha
- Cada card: role + modelo + status + diff stats (N files changed, +X -Y lines)
- Botão "Accept this" aplica o worktree ao repo principal
- Checkbox multi-select para "Merge selected (use Opus to reconcile)"
- Botão "Discard all" remove todos os worktrees sem aplicar nada

### 2. Handler IPC `swarm:apply-result`

```ts
import { execAsync } from '../git/utils'

ipcMain.handle('swarm:apply-result', async (_, sessionId: string, targetRepoPath: string) => {
  const worktreePath = worktreeManager.getPath(sessionId)
  if (!worktreePath) throw new Error('Worktree not found')

  // Criar patch do worktree e aplicar no repo principal
  const { stdout: patch } = await execAsync(
    `git diff HEAD`,
    { cwd: worktreePath }
  )

  await execAsync(`git apply --index -`, {
    cwd: targetRepoPath,
    input: patch,
  })
})
```

### 3. Diff stats por agente

Mostrar resumo: "+45 -12 lines · 3 files changed"  
Buscar via `git diff --stat HEAD` no worktree de cada agente.

---

## Critérios de aceite (DoD)

- [ ] Cards mostram resumo de cada agente ao completar
- [ ] "Accept this" aplica diff ao repo principal e limpa worktree
- [ ] "Discard all" remove todos os worktrees sem tocar no repo
- [ ] Diff stats exibidos por agente
- [ ] Confirmação antes de aplicar qualquer mudança
- [ ] TypeScript sem erros
