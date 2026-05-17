# T-02 · IPC Bridge (contextBridge API)

**Milestone:** M1  
**Depende de:** T-01  
**Pode rodar em paralelo com:** nenhuma (outros dependem daqui)  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

O Electron exige que a UI (renderer) não acesse Node.js diretamente.  
Toda comunicação precisa passar por um `preload.ts` que expõe uma API segura via `contextBridge`.  
Esta tarefa define o contrato completo da API que o renderer vai usar.

---

## O que fazer

### 1. Criar `src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent, Project, Session } from '../shared/types'

// API exposta ao renderer via window.agentforge
const api = {
  // Projects
  projects: {
    list: (): Promise<Project[]> =>
      ipcRenderer.invoke('projects:list'),
    create: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> =>
      ipcRenderer.invoke('projects:create', data),
    update: (id: string, data: Partial<Project>): Promise<Project> =>
      ipcRenderer.invoke('projects:update', id, data),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke('projects:delete', id),
  },

  // Sessions
  sessions: {
    list: (projectId: string): Promise<Session[]> =>
      ipcRenderer.invoke('sessions:list', projectId),
    get: (sessionId: string): Promise<Session | null> =>
      ipcRenderer.invoke('sessions:get', sessionId),
  },

  // Agent dispatch
  agent: {
    dispatch: (params: {
      projectId: string
      prompt: string
      modelOverride?: string
    }): Promise<{ sessionId: string }> =>
      ipcRenderer.invoke('agent:dispatch', params),

    approve: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('agent:approve', sessionId),

    reject: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('agent:reject', sessionId),

    cancel: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('agent:cancel', sessionId),

    killAll: (): Promise<void> =>
      ipcRenderer.invoke('agent:kill-all'),
  },

  // Swarm
  swarm: {
    spawn: (config: SwarmConfig): Promise<{ swarmId: string }> =>
      ipcRenderer.invoke('swarm:spawn', config),
    status: (swarmId: string): Promise<SwarmStatus> =>
      ipcRenderer.invoke('swarm:status', swarmId),
    cancel: (swarmId: string): Promise<void> =>
      ipcRenderer.invoke('swarm:cancel', swarmId),
  },

  // Event streaming (main → renderer)
  on: (event: string, callback: (payload: AgentEvent) => void) => {
    const handler = (_: unknown, payload: AgentEvent) => callback(payload)
    ipcRenderer.on(event, handler)
    // retorna função de cleanup
    return () => ipcRenderer.removeListener(event, handler)
  },

  // System
  system: {
    openInEditor: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('system:open-editor', filePath),
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('system:select-directory'),
    checkAgentInstalled: (agentId: string): Promise<boolean> =>
      ipcRenderer.invoke('system:check-agent', agentId),
  },
}

contextBridge.exposeInMainWorld('agentforge', api)

// Tipos para o SwarmConfig e SwarmStatus (importar de shared quando existirem)
type SwarmConfig = {
  projectId: string
  agents: Array<{ role: string; agentId: string; modelOverride?: string }>
  strategy: 'parallel' | 'sequential' | 'fan-out'
  prompt: string
}

type SwarmStatus = {
  swarmId: string
  sessions: Array<{ sessionId: string; role: string; status: string }>
}
```

### 2. Criar `src/preload/types.d.ts` — declaração global para o renderer

```ts
import type { AgentEvent, Project, Session } from '../shared/types'

declare global {
  interface Window {
    agentforge: {
      projects: {
        list(): Promise<Project[]>
        create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>
        update(id: string, data: Partial<Project>): Promise<Project>
        delete(id: string): Promise<void>
      }
      sessions: {
        list(projectId: string): Promise<Session[]>
        get(sessionId: string): Promise<Session | null>
      }
      agent: {
        dispatch(params: { projectId: string; prompt: string; modelOverride?: string }): Promise<{ sessionId: string }>
        approve(sessionId: string): Promise<void>
        reject(sessionId: string): Promise<void>
        cancel(sessionId: string): Promise<void>
        killAll(): Promise<void>
      }
      swarm: {
        spawn(config: unknown): Promise<{ swarmId: string }>
        status(swarmId: string): Promise<unknown>
        cancel(swarmId: string): Promise<void>
      }
      on(event: string, callback: (payload: AgentEvent) => void): () => void
      system: {
        openInEditor(filePath: string): Promise<void>
        selectDirectory(): Promise<string | null>
        checkAgentInstalled(agentId: string): Promise<boolean>
      }
    }
  }
}

export {}
```

### 3. Criar `src/main/ipc/index.ts` — stub dos handlers

```ts
import { ipcMain } from 'electron'

// Stubs — serão implementados nas tarefas T-03, T-05, T-06, etc.
export function registerIpcHandlers() {
  ipcMain.handle('projects:list', async () => [])
  ipcMain.handle('projects:create', async () => null)
  ipcMain.handle('projects:update', async () => null)
  ipcMain.handle('projects:delete', async () => null)

  ipcMain.handle('sessions:list', async () => [])
  ipcMain.handle('sessions:get', async () => null)

  ipcMain.handle('agent:dispatch', async () => ({ sessionId: 'stub' }))
  ipcMain.handle('agent:approve', async () => {})
  ipcMain.handle('agent:reject', async () => {})
  ipcMain.handle('agent:cancel', async () => {})
  ipcMain.handle('agent:kill-all', async () => {})

  ipcMain.handle('swarm:spawn', async () => ({ swarmId: 'stub' }))
  ipcMain.handle('swarm:status', async () => ({}))
  ipcMain.handle('swarm:cancel', async () => {})

  ipcMain.handle('system:open-editor', async () => {})
  ipcMain.handle('system:select-directory', async () => null)
  ipcMain.handle('system:check-agent', async () => false)
}
```

### 4. Atualizar `src/main/index.ts` para chamar registerIpcHandlers()

```ts
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc'

app.whenReady().then(() => {
  registerIpcHandlers()
  // criar janela...
})
```

### 5. Criar teste de smoke

Criar `src/preload/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

// Smoke test: verifica que o módulo de tipos compila
describe('preload types', () => {
  it('should export api shape', () => {
    // Este teste apenas valida que o TypeScript compila os tipos
    const mockApi = {
      projects: { list: async () => [], create: async () => null, update: async () => null, delete: async () => {} },
      sessions: { list: async () => [], get: async () => null },
      agent: { dispatch: async () => ({ sessionId: '' }), approve: async () => {}, reject: async () => {}, cancel: async () => {}, killAll: async () => {} },
      swarm: { spawn: async () => ({ swarmId: '' }), status: async () => ({}), cancel: async () => {} },
      on: () => () => {},
      system: { openInEditor: async () => {}, selectDirectory: async () => null, checkAgentInstalled: async () => false },
    }
    expect(mockApi.projects).toBeDefined()
    expect(mockApi.agent).toBeDefined()
    expect(mockApi.swarm).toBeDefined()
  })
})
```

---

## Critérios de aceite (DoD)

- [ ] `src/preload/index.ts` expõe `window.agentforge` com todas as seções (projects, sessions, agent, swarm, on, system)
- [ ] `src/preload/types.d.ts` garante que o renderer tenha tipos corretos sem importar electron
- [ ] `src/main/ipc/index.ts` registra todos os handlers como stubs (sem crash)
- [ ] `src/main/index.ts` chama `registerIpcHandlers()` antes de criar a janela
- [ ] TypeScript compila sem erros no renderer quando usar `window.agentforge.*`
- [ ] Teste de smoke passa: `npm test`
- [ ] Ao rodar `npm run dev`, o console não exibe erros de IPC

---

## Validação

```bash
npx tsc --noEmit    # zero erros
npm test            # smoke test passa
npm run dev         # abre sem erros no console
```

## Nota para o agente

Não implemente a lógica real dos handlers ainda — isso será feito nas tarefas T-03 (ProjectStore) e T-05 (ProcessPool). O objetivo aqui é apenas definir o contrato da API e garantir que tudo compila.
