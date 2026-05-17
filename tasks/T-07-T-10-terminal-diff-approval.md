# T-07 · TerminalPanel + TaskInput UI

**Milestone:** M2  
**Depende de:** T-04, T-06  
**Pode rodar em paralelo com:** T-11 (Codex adapter)  
**Estimativa:** 4–5h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Painel principal do app. O usuário digita uma task em linguagem natural, despacha para o agente,  
e vê o output em streaming num terminal emulado (xterm.js).

---

## O que fazer

### 1. Criar `src/renderer/components/TaskInput/index.tsx`

```tsx
interface Props {
  projectId: string
  onSessionStarted: (sessionId: string) => void
}
```

Elementos:
- Textarea grande (auto-resize) para o prompt
- Dropdown de override de modelo (opcional — "Auto" por padrão)
- Botão "Run" → chama `window.agentforge.agent.dispatch({ projectId, prompt })`
- Atalho `⌘Enter` para submeter
- Indicador do modelo que será usado (atualiza ao digitar conforme o router sugere)
- Estado: idle / loading / running / awaiting-approval

### 2. Criar `src/renderer/components/TerminalPanel/index.tsx`

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

interface Props {
  sessionId: string | null
}

export function TerminalPanel({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#18181b',   // zinc-900
        foreground: '#f4f4f5',   // zinc-100
        cursor: '#a1a1aa',
      },
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.5,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term

    return () => term.dispose()
  }, [])

  useEffect(() => {
    if (!sessionId || !termRef.current) return
    const term = termRef.current
    term.clear()

    // Assinar eventos da session
    const unsubscribe = window.agentforge.on(`session:${sessionId}`, (event) => {
      if (event.type === 'stdout' || event.type === 'stderr') {
        const payload = event.payload as { text?: string }
        if (payload.text) term.write(payload.text)
      }
    })

    return unsubscribe
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-zinc-900 rounded-lg overflow-hidden"
      style={{ minHeight: 300 }}
    />
  )
}
```

### 3. Criar `src/renderer/components/SessionHeader/index.tsx`

Header da thread com:
- Nome do projeto
- Prompt truncado (2 linhas)
- Badge: status (running / done / error)
- Modelo usado + tier badge
- Custo estimado (ex: "~$0.003")
- Botões: Cancel (se running), Fork (se done)
- Atalho: `⌘A` para aprovar

### 4. Handler IPC: repassar eventos para o renderer

Em `src/main/ipc/index.ts`, quando um dispatch acontecer:
```ts
import { BrowserWindow } from 'electron'

// Dentro do handler agent:dispatch, após receber a AgentSession:
session.events.on('event', (agentEvent: AgentEvent) => {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(`session:${agentEvent.sessionId}`, agentEvent)
})
```

### 5. Layout da main view

```tsx
// src/renderer/App.tsx (atualizar)
export function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <ProjectSidebar
        selectedProjectId={selectedProject?.id ?? null}
        onSelect={setSelectedProject}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {selectedProject ? (
          <>
            <SessionHeader sessionId={activeSessionId} />
            <TerminalPanel sessionId={activeSessionId} />
            <TaskInput
              projectId={selectedProject.id}
              onSessionStarted={setActiveSessionId}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Select a project to start
          </div>
        )}
      </main>
    </div>
  )
}
```

---

## Critérios de aceite (DoD)

- [ ] Campo de task aceita texto, submete com `⌘Enter` ou botão
- [ ] Ao despachar, `sessionId` é retornado e o terminal começa a receber eventos
- [ ] Output do agente aparece em streaming no terminal (sem buffer delay visível)
- [ ] Terminal usa tema dark com fonte monospace
- [ ] Terminal faz resize responsivo (FitAddon)
- [ ] SessionHeader mostra status correto em tempo real
- [ ] Estado "running" desabilita o botão Run e mostra spinner
- [ ] TypeScript sem erros

---
---

# T-08 · Streaming Parser e SessionManager

**Milestone:** M2  
**Depende de:** T-06  
**Pode rodar em paralelo com:** T-07 (UI)  
**Estimativa:** 3h  
**Agente sugerido:** claude-sonnet / codex  

---

## Contexto

O SessionManager coordena: criar session no DB, despachar para o adapter correto,  
repassar eventos via IPC para o renderer, atualizar status no DB ao final.

---

## O que fazer

### 1. Criar `src/main/session/SessionManager.ts`

```ts
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { adapterRegistry } from '../agents'
import { sessionsStore } from '../store'
import type { AgentEvent } from '../../shared/types'

export class SessionManager {
  private activeSessions = new Map<string, { cancel: () => void }>()

  async dispatch(params: {
    projectId: string
    prompt: string
    agentId: string
    model: string
    repoPath: string
  }): Promise<string> {
    const sessionId = randomUUID()

    const adapter = adapterRegistry.get(params.agentId)
    if (!adapter) throw new Error(`Adapter not found: ${params.agentId}`)

    // Criar session no DB
    sessionsStore.create({
      id: sessionId,
      projectId: params.projectId,
      agentId: params.agentId as never,
      model: params.model,
      prompt: params.prompt,
      status: 'running',
    })

    // Disparar adapter
    const agentSession = await adapter.dispatch({
      sessionId,
      prompt: params.prompt,
      repoPath: params.repoPath,
      model: params.model,
    })

    this.activeSessions.set(sessionId, { cancel: () => agentSession.cancel() })

    // Repassar eventos para o renderer
    agentSession.events.on('event', (event: AgentEvent) => {
      this.broadcast(event)

      if (event.type === 'session-complete') {
        sessionsStore.updateStatus(sessionId, 'done')
        this.activeSessions.delete(sessionId)
      }
      if (event.type === 'error') {
        sessionsStore.updateStatus(sessionId, 'error')
        this.activeSessions.delete(sessionId)
      }
    })

    return sessionId
  }

  cancel(sessionId: string) {
    this.activeSessions.get(sessionId)?.cancel()
    sessionsStore.updateStatus(sessionId, 'cancelled')
    this.activeSessions.delete(sessionId)
  }

  cancelAll() {
    for (const sessionId of this.activeSessions.keys()) {
      this.cancel(sessionId)
    }
  }

  private broadcast(event: AgentEvent) {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(`session:${event.sessionId}`, event)
  }
}

export const sessionManager = new SessionManager()
```

### 2. Atualizar handler `agent:dispatch` no IPC

```ts
import { sessionManager } from '../session/SessionManager'
import { projectsStore } from '../store'
// ModelRouter será usado na T-14 — por ora usar modelo fixo

ipcMain.handle('agent:dispatch', async (_, params) => {
  const project = projectsStore.get(params.projectId)
  if (!project) throw new Error('Project not found')

  const sessionId = await sessionManager.dispatch({
    projectId: params.projectId,
    prompt: params.prompt,
    agentId: project.agentId,
    model: params.modelOverride ?? 'claude-sonnet-4-6',
    repoPath: project.repoPath,
  })

  return { sessionId }
})

ipcMain.handle('agent:cancel', async (_, sessionId) => {
  sessionManager.cancel(sessionId)
})
```

---

## Critérios de aceite (DoD)

- [ ] `sessionManager.dispatch()` cria session no DB, spawna adapter, retorna `sessionId`
- [ ] Eventos do adapter chegam ao renderer via `win.webContents.send`
- [ ] Session marcada como `done` ao receber `session-complete`
- [ ] Session marcada como `error` ao receber `error`
- [ ] `cancel()` encerra processo e atualiza DB
- [ ] TypeScript sem erros

---
---

# T-09 · DiffViewer

**Milestone:** M2  
**Depende de:** T-07  
**Pode rodar em paralelo com:** T-11  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Quando o agente propõe mudanças em arquivos, exibe um diff side-by-side com Monaco Editor.  
O usuário pode aceitar, rejeitar ou editar antes de aplicar.

---

## O que fazer

### 1. Estender `AgentEvent` em `src/shared/types.ts`

```ts
export interface DiffProposal {
  filePath: string
  originalContent: string
  proposedContent: string
  description?: string
}

// No AgentEvent, quando type === 'diff', payload é DiffProposal[]
```

### 2. Criar `src/renderer/components/DiffViewer/index.tsx`

```tsx
import { DiffEditor } from '@monaco-editor/react'

interface Props {
  proposals: DiffProposal[]
  onApprove: (filePath: string) => void
  onReject: (filePath: string) => void
  onEditAndApprove: (filePath: string, newContent: string) => void
}

export function DiffViewer({ proposals, onApprove, onReject, onEditAndApprove }: Props) {
  const [selected, setSelected] = useState(0)
  const current = proposals[selected]

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Tab bar — um por arquivo */}
      <div className="flex border-b border-zinc-700 overflow-x-auto">
        {proposals.map((p, i) => (
          <button
            key={p.filePath}
            onClick={() => setSelected(i)}
            className={`px-3 py-2 text-xs ${i === selected ? 'text-zinc-100 border-b-2 border-blue-500' : 'text-zinc-400'}`}
          >
            {p.filePath.split('/').pop()}
          </button>
        ))}
      </div>

      {/* Monaco diff editor */}
      <div className="flex-1">
        <DiffEditor
          height="100%"
          theme="vs-dark"
          original={current.originalContent}
          modified={current.proposedContent}
          options={{
            readOnly: false,
            renderSideBySide: true,
            minimap: { enabled: false },
          }}
        />
      </div>

      {/* Action bar */}
      <div className="flex gap-2 p-3 border-t border-zinc-700">
        <button onClick={() => onApprove(current.filePath)}
          className="px-4 py-1.5 bg-green-700 text-white rounded text-sm">
          ✓ Accept
        </button>
        <button onClick={() => onReject(current.filePath)}
          className="px-4 py-1.5 bg-red-800 text-white rounded text-sm">
          ✗ Reject
        </button>
        <span className="text-xs text-zinc-500 ml-auto self-center">
          {selected + 1} / {proposals.length} files
        </span>
      </div>
    </div>
  )
}
```

### 3. Handler IPC para aplicar diff

Em `src/main/ipc/index.ts`:

```ts
import fs from 'node:fs/promises'

ipcMain.handle('diff:apply', async (_, filePath: string, content: string) => {
  // Backup antes de aplicar
  const backup = filePath + '.agentforge-backup'
  await fs.copyFile(filePath, backup)
  await fs.writeFile(filePath, content, 'utf-8')
  await fs.unlink(backup) // remover backup após sucesso
})

ipcMain.handle('diff:reject', async () => {
  // Apenas notificar o agente — não escreve nada em disco
})
```

### 4. Integrar no TerminalPanel

Quando receber evento `type: 'diff'`, o TerminalPanel deve:
1. Renderizar o DiffViewer sobreposto (ou em panel separado)
2. Bloquear nova task enquanto há diff pendente
3. Ao aceitar/rejeitar, chamar `window.agentforge.agent.approve/reject`

---

## Critérios de aceite (DoD)

- [ ] DiffViewer renderiza Monaco diff side-by-side
- [ ] Tab bar para múltiplos arquivos modificados
- [ ] Botão Accept chama `diff:apply` e escreve em disco
- [ ] Botão Reject não toca em disco
- [ ] Backup criado antes de escrever (e removido após sucesso)
- [ ] `⌘A` (atalho global) chama Accept no diff atual
- [ ] TypeScript sem erros

---
---

# T-10 · ApprovalFlow

**Milestone:** M2  
**Depende de:** T-09  
**Pode rodar em paralelo com:** T-11  
**Estimativa:** 2h  
**Agente sugerido:** claude-haiku  

---

## Contexto

Quando o agente solicita aprovação antes de executar uma ação (escrever arquivo, rodar comando),  
o app precisa apresentar o pedido e aguardar resposta do usuário.

---

## O que fazer

### 1. Adicionar tipo `approval-request` em `AgentEvent`

```ts
export interface ApprovalRequest {
  action: 'write-file' | 'run-command' | 'delete-file' | 'other'
  description: string
  details: string  // ex: path do arquivo ou comando a executar
}
```

### 2. Criar `src/renderer/components/ApprovalBanner/index.tsx`

Banner não-intrusivo que aparece na parte inferior do terminal quando há aprovação pendente:

```tsx
interface Props {
  request: ApprovalRequest
  sessionId: string
  onApprove: () => void
  onReject: () => void
}

export function ApprovalBanner({ request, sessionId, onApprove, onReject }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-amber-950 border-t border-amber-700">
      <span className="text-amber-400 text-sm font-mono">⚡ {request.action}</span>
      <span className="text-amber-200 text-sm flex-1 truncate">{request.description}</span>
      <button onClick={onReject} className="px-3 py-1 text-xs text-red-400 border border-red-800 rounded">
        Deny
      </button>
      <button onClick={onApprove} className="px-3 py-1 text-xs text-green-400 border border-green-800 rounded">
        Allow ⌘A
      </button>
    </div>
  )
}
```

### 3. Registrar atalho global `⌘A`

Em `src/main/index.ts`:
```ts
import { globalShortcut } from 'electron'

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send('shortcut:approve')
  })
})
```

No renderer, ouvir `shortcut:approve` e chamar approve no banner ativo.

---

## Critérios de aceite (DoD)

- [ ] Banner aparece quando agente emite `approval-request`
- [ ] Approve chama `window.agentforge.agent.approve(sessionId)`
- [ ] Deny chama `window.agentforge.agent.reject(sessionId)`
- [ ] `⌘⇧A` aprova sem clicar
- [ ] Banner desaparece após resposta
- [ ] Se sessão cancelada, banner é removido automaticamente
- [ ] TypeScript sem erros
