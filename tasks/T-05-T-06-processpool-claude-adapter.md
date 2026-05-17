# T-05 · ProcessPool

**Milestone:** M1  
**Depende de:** T-02  
**Pode rodar em paralelo com:** T-03, T-04  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet / codex  

---

## Contexto

Gerenciamento do ciclo de vida de processos CLI de agentes.  
O ProcessPool spawna, rastreia e encerra processos — garantindo cleanup mesmo em crashes do Electron.

---

## O que fazer

### 1. Criar `src/main/process/ProcessPool.ts`

```ts
import { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface ManagedProcess {
  pid: number
  sessionId: string
  process: ChildProcess
  startedAt: number
}

export class ProcessPool extends EventEmitter {
  private processes = new Map<string, ManagedProcess>()

  spawn(sessionId: string, command: string, args: string[], options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  }): ChildProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!child.pid) throw new Error(`Failed to spawn ${command}`)

    this.processes.set(sessionId, {
      pid: child.pid,
      sessionId,
      process: child,
      startedAt: Date.now(),
    })

    child.on('exit', (code, signal) => {
      this.processes.delete(sessionId)
      this.emit('process-exit', { sessionId, code, signal })
    })

    return child
  }

  get(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId)
  }

  kill(sessionId: string): void {
    const managed = this.processes.get(sessionId)
    if (!managed) return
    managed.process.kill('SIGTERM')
    // force kill após 3s se não terminar
    setTimeout(() => {
      if (this.processes.has(sessionId)) {
        managed.process.kill('SIGKILL')
      }
    }, 3000)
  }

  killAll(): void {
    for (const sessionId of this.processes.keys()) {
      this.kill(sessionId)
    }
  }

  list(): ManagedProcess[] {
    return Array.from(this.processes.values())
  }
}

// Singleton
export const processPool = new ProcessPool()
```

### 2. Registrar cleanup no Electron

Em `src/main/index.ts`:

```ts
import { app } from 'electron'
import { processPool } from './process/ProcessPool'

app.on('will-quit', () => {
  processPool.killAll()
})

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  processPool.killAll()
})
```

### 3. Handler IPC para kill-all

Em `src/main/ipc/index.ts`:
```ts
import { processPool } from '../process/ProcessPool'

ipcMain.handle('agent:kill-all', async () => {
  processPool.killAll()
})
```

### 4. Testes

```ts
// src/main/process/ProcessPool.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessPool } from './ProcessPool'

describe('ProcessPool', () => {
  it('spawns and tracks a process', async () => {
    const pool = new ProcessPool()
    const child = pool.spawn('test-session', 'echo', ['hello'], { cwd: process.cwd() })
    expect(pool.get('test-session')).toBeDefined()
    await new Promise(resolve => child.on('exit', resolve))
    expect(pool.get('test-session')).toBeUndefined()
  })

  it('killAll terminates all processes', () => {
    const pool = new ProcessPool()
    pool.spawn('s1', 'sleep', ['10'], { cwd: process.cwd() })
    pool.spawn('s2', 'sleep', ['10'], { cwd: process.cwd() })
    expect(pool.list().length).toBe(2)
    pool.killAll()
  })
})
```

---

## Critérios de aceite (DoD)

- [ ] `processPool.spawn()` retorna `ChildProcess` e rastreia no Map
- [ ] Process removido do Map automaticamente ao encerrar
- [ ] `kill()` envia SIGTERM e SIGKILL após 3s
- [ ] `killAll()` encerra todos os processos
- [ ] Cleanup registrado em `will-quit` e `uncaughtException`
- [ ] Testes passam
- [ ] TypeScript sem erros

---
---

# T-06 · ClaudeCode Adapter

**Milestone:** M1  
**Depende de:** T-05  
**Pode rodar em paralelo com:** T-04  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Adapter que spawna o `claude` CLI (Claude Code) e parseia seu output em eventos estruturados.  
O Claude Code emite JSON por linha (JSONL) quando rodado com `--output-format json`.

---

## O que fazer

### 1. Criar interface base `src/main/agents/AgentAdapter.ts`

```ts
import type { EventEmitter } from 'node:events'
import type { AgentEvent } from '../../shared/types'

export interface AgentSession {
  sessionId: string
  events: EventEmitter  // emite AgentEvent
  approve(): void
  reject(): void
  cancel(): void
}

export interface AgentAdapter {
  id: string
  name: string
  isInstalled(): Promise<boolean>
  dispatch(params: {
    sessionId: string
    prompt: string
    repoPath: string
    model: string
    context?: string  // conteúdo do AGENTS.md
  }): Promise<AgentSession>
}
```

### 2. Criar `src/main/agents/ClaudeCodeAdapter.ts`

```ts
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { processPool } from '../process/ProcessPool'
import type { AgentAdapter, AgentSession } from './AgentAdapter'
import type { AgentEvent } from '../../shared/types'

const execAsync = promisify(exec)

export class ClaudeCodeAdapter implements AgentAdapter {
  id = 'claude-code'
  name = 'Claude Code'

  async isInstalled(): Promise<boolean> {
    try {
      await execAsync('which claude')
      return true
    } catch {
      return false
    }
  }

  async dispatch(params: {
    sessionId: string
    prompt: string
    repoPath: string
    model: string
    context?: string
  }): Promise<AgentSession> {
    const events = new EventEmitter()

    const args = [
      '--print',                          // non-interactive mode
      '--output-format', 'json',          // JSONL output
      '--model', params.model,
      '--dangerously-skip-permissions',   // para uso programático; ajustar conforme necessário
    ]

    if (params.context) {
      // escrever context temporário ou passar via --system
    }

    const child = processPool.spawn(params.sessionId, 'claude', args, {
      cwd: params.repoPath,
      env: { CLAUDE_PROMPT: params.prompt },
    })

    // Parsear stdout linha a linha (JSONL)
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const data = JSON.parse(line)
        const event: AgentEvent = mapClaudeOutputToEvent(data, params.sessionId)
        events.emit('event', event)
      } catch {
        // linha não é JSON — tratar como stdout raw
        events.emit('event', {
          type: 'stdout',
          sessionId: params.sessionId,
          payload: { text: line },
          timestamp: Date.now(),
        } satisfies AgentEvent)
      }
    })

    // Stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      events.emit('event', {
        type: 'stderr',
        sessionId: params.sessionId,
        payload: { text: chunk.toString() },
        timestamp: Date.now(),
      } satisfies AgentEvent)
    })

    // Exit
    child.on('exit', (code) => {
      events.emit('event', {
        type: 'session-complete',
        sessionId: params.sessionId,
        payload: { exitCode: code },
        timestamp: Date.now(),
      } satisfies AgentEvent)
    })

    return {
      sessionId: params.sessionId,
      events,
      approve: () => {
        // Claude Code com --dangerously-skip-permissions não precisa de approval
        // Para modo interativo, enviar 'y\n' via stdin
        child.stdin?.write('y\n')
      },
      reject: () => {
        child.stdin?.write('n\n')
      },
      cancel: () => {
        processPool.kill(params.sessionId)
      },
    }
  }
}

function mapClaudeOutputToEvent(data: unknown, sessionId: string): AgentEvent {
  // Mapear formato de output do claude CLI para AgentEvent
  // O formato exato depende da versão do Claude Code — adaptar conforme necessário
  const d = data as Record<string, unknown>

  if (d.type === 'assistant' && typeof d.message === 'object') {
    return { type: 'stdout', sessionId, payload: d, timestamp: Date.now() }
  }
  if (d.type === 'tool_use') {
    return { type: 'stdout', sessionId, payload: d, timestamp: Date.now() }
  }
  if (d.type === 'result') {
    return { type: 'session-complete', sessionId, payload: d, timestamp: Date.now() }
  }

  return { type: 'stdout', sessionId, payload: d, timestamp: Date.now() }
}
```

### 3. Criar barrel `src/main/agents/index.ts`

```ts
export { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
export type { AgentAdapter, AgentSession } from './AgentAdapter'

import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'

// Registry de adapters disponíveis
export const adapterRegistry = new Map([
  ['claude-code', new ClaudeCodeAdapter()],
])
```

### 4. Verificar instalação no startup

Em `src/main/index.ts`, ao iniciar:
```ts
import { adapterRegistry } from './agents'

for (const [id, adapter] of adapterRegistry) {
  const installed = await adapter.isInstalled()
  console.log(`[agents] ${id}: ${installed ? 'OK' : 'NOT FOUND'}`)
}
```

---

## Critérios de aceite (DoD)

- [ ] `ClaudeCodeAdapter.isInstalled()` retorna `true` se `claude` CLI está no PATH
- [ ] `dispatch()` spawna processo `claude` com args corretos
- [ ] Stdout JSONL parseia para `AgentEvent` sem crash em linhas malformadas
- [ ] Stderr emite eventos `type: 'stderr'`
- [ ] `cancel()` encerra o processo via `processPool.kill()`
- [ ] `adapterRegistry` expõe o adapter `claude-code`
- [ ] TypeScript sem erros

---

## Nota para o agente

O formato exato de output do `claude --output-format json` pode variar com a versão.  
Se não tiver o Claude Code instalado no ambiente de dev, use um mock:

```ts
// src/main/agents/__mocks__/claude-mock.sh
#!/bin/bash
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello from mock"}]}}'
sleep 0.5
echo '{"type":"result","subtype":"success","cost_usd":0.001}'
```

Ajuste o adapter para aceitar `CLAUDE_COMMAND` env var para facilitar testes:
```ts
const command = process.env.CLAUDE_COMMAND ?? 'claude'
```
