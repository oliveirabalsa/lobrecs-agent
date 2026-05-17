# T-11 · Codex Adapter

**Milestone:** M2  
**Depende de:** T-05 (ProcessPool)  
**Pode rodar em paralelo com:** T-07, T-08, T-09, T-10  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet / codex  

---

## Contexto

Adapter para o Codex CLI da OpenAI (`@openai/codex`).  
O Codex usa o Codex App Server Protocol — JSON-RPC bidirecional com primitivas Item/Turn/Thread.

---

## O que fazer

### 1. Criar `src/main/agents/CodexAdapter.ts`

```ts
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { processPool } from '../process/ProcessPool'
import type { AgentAdapter, AgentSession } from './AgentAdapter'
import type { AgentEvent } from '../../shared/types'

const execAsync = promisify(exec)

export class CodexAdapter implements AgentAdapter {
  id = 'codex'
  name = 'OpenAI Codex'

  async isInstalled(): Promise<boolean> {
    try {
      await execAsync('which codex')
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
  }): Promise<AgentSession> {
    const events = new EventEmitter()

    // Codex CLI: `codex --model <model> "<prompt>"`
    // Com --approval-policy untrusted para pedir aprovação antes de ações
    const args = [
      '--model', params.model,
      '--approval-policy', 'untrusted',
      '--quiet',
      params.prompt,
    ]

    const child = processPool.spawn(params.sessionId, 'codex', args, {
      cwd: params.repoPath,
    })

    // Codex pode emitir JSONL ou texto dependendo do modo
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      const event = parseCodexLine(line, params.sessionId)
      events.emit('event', event)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      events.emit('event', {
        type: 'stderr',
        sessionId: params.sessionId,
        payload: { text: chunk.toString() },
        timestamp: Date.now(),
      } satisfies AgentEvent)
    })

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
      approve: () => child.stdin?.write('y\n'),
      reject: () => child.stdin?.write('n\n'),
      cancel: () => processPool.kill(params.sessionId),
    }
  }
}

function parseCodexLine(line: string, sessionId: string): AgentEvent {
  try {
    const data = JSON.parse(line) as Record<string, unknown>
    // Codex App Server Protocol: Item types
    // type: "message" | "tool_call" | "tool_result" | "approval_request" | "turn_complete"
    if (data.type === 'approval_request') {
      return {
        type: 'approval-request',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }
    if (data.type === 'turn_complete') {
      return {
        type: 'session-complete',
        sessionId,
        payload: data,
        timestamp: Date.now(),
      }
    }
    return { type: 'stdout', sessionId, payload: data, timestamp: Date.now() }
  } catch {
    return {
      type: 'stdout',
      sessionId,
      payload: { text: line },
      timestamp: Date.now(),
    }
  }
}
```

### 2. Registrar no `adapterRegistry`

Em `src/main/agents/index.ts`:
```ts
import { CodexAdapter } from './CodexAdapter'

export const adapterRegistry = new Map([
  ['claude-code', new ClaudeCodeAdapter()],
  ['codex', new CodexAdapter()],
])
```

### 3. Verificar modelo correto para Codex

Modelos Codex válidos (via env ou config):
- `gpt-5.2-codex` (balanced)
- `gpt-5.4` (advanced)
- `gpt-5.5` (frontier)

Adicionar em `src/shared/types.ts`:
```ts
export const MODEL_MAP: Record<string, Record<ModelTier, string>> = {
  'claude-code': {
    lightweight: 'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6',
    advanced: 'claude-opus-4-6',
    frontier: 'claude-opus-4-6',
  },
  'codex': {
    lightweight: 'gpt-5.2-codex',
    balanced: 'gpt-5.2-codex',
    advanced: 'gpt-5.4',
    frontier: 'gpt-5.5',
  },
  'opencode': {
    lightweight: 'minimax',
    balanced: 'minimax',
    advanced: 'claude-sonnet-4-6',
    frontier: 'claude-opus-4-6',
  },
}
```

---

## Critérios de aceite (DoD)

- [ ] `CodexAdapter.isInstalled()` retorna true se `codex` CLI está no PATH
- [ ] `dispatch()` spawna `codex` com args corretos
- [ ] `approval_request` events são mapeados para `type: 'approval-request'`
- [ ] `adapterRegistry` inclui `codex`
- [ ] `MODEL_MAP` exportado de `shared/types.ts`
- [ ] TypeScript sem erros

---
---

# T-12 · SessionHistory Panel

**Milestone:** M2  
**Depende de:** T-07, T-08  
**Pode rodar em paralelo com:** T-11  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-haiku / codex  

---

## Contexto

Painel lateral (retrátil) que mostra o histórico de sessions do projeto selecionado.  
Permite revisar outputs passados e fazer "fork" de uma session anterior.

---

## O que fazer

### 1. Criar `src/renderer/components/HistoryPanel/index.tsx`

```tsx
interface Props {
  projectId: string
  onFork: (sessionId: string) => void
}
```

Lista de sessions com:
- Prompt truncado (1 linha)
- Modelo + tier badge
- Data/hora (usar `date-fns format(new Date(s.createdAt), 'dd/MM HH:mm')`)
- Duração da session
- Custo: "~$0.003"
- Status badge (done / error / cancelled)
- Botão "Fork" → clona a session com mesmo prompt + contexto

### 2. Usar `date-fns` para formatação (já na dep list do T-01)

```ts
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ex: "há 3 horas" ou "03/06 14:22"
```

### 3. Criar handler IPC `sessions:fork`

```ts
// src/main/ipc/index.ts
ipcMain.handle('sessions:fork', async (_, sessionId: string) => {
  const original = sessionsStore.get(sessionId)
  if (!original) throw new Error('Session not found')

  // Retornar o prompt original — o renderer vai pré-preencher o TaskInput
  return { prompt: original.prompt, agentId: original.agentId, model: original.model }
})
```

### 4. Adicionar método no preload

```ts
// window.agentforge.sessions
fork: (sessionId: string): Promise<{ prompt: string; agentId: string; model: string }> =>
  ipcRenderer.invoke('sessions:fork', sessionId),
```

---

## Critérios de aceite (DoD)

- [ ] Lista sessions do projeto ordenadas por `createdAt DESC`
- [ ] Data formatada com `date-fns` (ptBR locale)
- [ ] Custo exibido em USD formatado ("$0.0032")
- [ ] Botão Fork pré-preenche TaskInput com prompt da session original
- [ ] Painel é retrátil (toggle button, persiste estado em localStorage do renderer)
- [ ] TypeScript sem erros

---
---

# T-13 · Complexity Scorer

**Milestone:** M3  
**Depende de:** T-02 (shared types)  
**Pode rodar em paralelo com:** qualquer tarefa de UI do M2  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Módulo de scoring que analisa um prompt e retorna um score 0–100 de complexidade.  
Não usa LLM — roda localmente em <50ms usando heurísticas.

---

## O que fazer

### 1. Criar `src/main/router/ComplexityScorer.ts`

```ts
export interface ScoringResult {
  score: number           // 0–100
  tier: ModelTier
  signals: ScoringSignal[]
  reasoning: string       // texto human-readable para exibir na UI
}

export interface ScoringSignal {
  name: string
  score: number           // contribuição 0–100
  weight: number          // peso do sinal (0–1, soma = 1)
  matched: boolean
}

export function scoreComplexity(prompt: string, context?: {
  repoPath?: string
  recentFailures?: Array<{ prompt: string; tier: ModelTier; failed: boolean }>
}): ScoringResult {
  const signals: ScoringSignal[] = [
    scoreLengthSignal(prompt),
    scoreReasoningKeywords(prompt),
    scoreNewCreationKeywords(prompt),
    scoreCrossServiceKeywords(prompt),
    scoreFileCountEstimate(prompt),
    scoreHistorySignal(prompt, context?.recentFailures),
  ]

  const totalScore = signals.reduce((acc, s) => acc + (s.score * s.weight), 0)
  const tier = scoreTotierResult(totalScore)

  return {
    score: Math.round(totalScore),
    tier,
    signals,
    reasoning: buildReasoning(signals, tier),
  }
}

// --- Sinais individuais ---

function scoreLengthSignal(prompt: string): ScoringSignal {
  const words = prompt.split(/\s+/).length
  const score = Math.min(100, (words / 50) * 100)  // 50 palavras = 100
  return { name: 'prompt-length', score, weight: 0.10, matched: words > 20 }
}

function scoreReasoningKeywords(prompt: string): ScoringSignal {
  const keywords = [
    'architect', 'design', 'tradeoff', 'migrate', 'refactor',
    'performance', 'scalab', 'security', 'system', 'strategy',
    'implement from scratch', 'new module', 'new service',
  ]
  const lower = prompt.toLowerCase()
  const matches = keywords.filter(k => lower.includes(k)).length
  const score = Math.min(100, (matches / 3) * 100)
  return { name: 'reasoning-keywords', score, weight: 0.30, matched: matches > 0 }
}

function scoreNewCreationKeywords(prompt: string): ScoringSignal {
  const keywords = ['create', 'build', 'implement', 'develop', 'novo', 'criar', 'from scratch']
  const lower = prompt.toLowerCase()
  const matches = keywords.filter(k => lower.includes(k)).length
  const score = matches > 0 ? 60 : 0
  return { name: 'new-creation', score, weight: 0.20, matched: matches > 0 }
}

function scoreCrossServiceKeywords(prompt: string): ScoringSignal {
  const keywords = ['microservice', 'service', 'module', 'package', 'endpoint', 'api', 'integration']
  const lower = prompt.toLowerCase()
  const count = keywords.filter(k => lower.includes(k)).length
  const score = Math.min(100, count * 25)
  return { name: 'cross-service', score, weight: 0.20, matched: count > 1 }
}

function scoreFileCountEstimate(prompt: string): ScoringSignal {
  // Estimar quantidade de arquivos mencionados
  const filePatterns = /\.(ts|js|tsx|jsx|go|py|rs|kt|java|sql|yaml|json)\b/g
  const matches = prompt.match(filePatterns)?.length ?? 0
  const score = Math.min(100, matches * 15)
  return { name: 'file-count', score, weight: 0.10, matched: matches > 2 }
}

function scoreHistorySignal(
  prompt: string,
  recentFailures?: Array<{ prompt: string; tier: ModelTier; failed: boolean }>
): ScoringSignal {
  if (!recentFailures?.length) {
    return { name: 'history', score: 0, weight: 0.10, matched: false }
  }

  // Se prompts similares falharam com tier menor, aumentar score
  const similar = recentFailures.filter(f =>
    f.failed && f.tier !== 'frontier' &&
    cosineSimilaritySimple(prompt, f.prompt) > 0.5
  )
  const score = similar.length > 0 ? 80 : 0
  return { name: 'history', score, weight: 0.10, matched: similar.length > 0 }
}

function cosineSimilaritySimple(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/))
  const setB = new Set(b.toLowerCase().split(/\s+/))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  return intersection.size / Math.sqrt(setA.size * setB.size)
}

function scoreTotierResult(score: number): ModelTier {
  if (score <= 30) return 'lightweight'
  if (score <= 65) return 'balanced'
  if (score <= 85) return 'advanced'
  return 'frontier'
}

function buildReasoning(signals: ScoringSignal[], tier: ModelTier): string {
  const active = signals.filter(s => s.matched).map(s => s.name)
  if (active.length === 0) return `Simple task → using ${tier} tier`
  return `Signals: ${active.join(', ')} → ${tier} tier`
}
```

### 2. Testes obrigatórios

Criar `src/main/router/ComplexityScorer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scoreComplexity } from './ComplexityScorer'

describe('scoreComplexity', () => {
  it('rates a simple bug fix as lightweight', () => {
    const result = scoreComplexity('fix the typo in the button label')
    expect(result.tier).toBe('lightweight')
    expect(result.score).toBeLessThan(30)
  })

  it('rates a refactor as balanced', () => {
    const result = scoreComplexity('refactor the auth service to use JWT tokens')
    expect(['balanced', 'advanced']).toContain(result.tier)
  })

  it('rates a system design as advanced or frontier', () => {
    const result = scoreComplexity(
      'design and implement a new microservice for payment processing with Kafka integration and security review'
    )
    expect(['advanced', 'frontier']).toContain(result.tier)
    expect(result.score).toBeGreaterThan(60)
  })

  it('returns signals array with all weights', () => {
    const result = scoreComplexity('anything')
    const totalWeight = result.signals.reduce((a, s) => a + s.weight, 0)
    expect(totalWeight).toBeCloseTo(1.0, 1)
  })
})
```

---

## Critérios de aceite (DoD)

- [ ] `scoreComplexity` roda em <50ms para qualquer prompt
- [ ] Retorna `score` entre 0 e 100
- [ ] Retorna `tier` correto para cada range de score
- [ ] Retorna `signals` com pesos que somam ~1.0
- [ ] Retorna `reasoning` string legível
- [ ] Todos os testes passam
- [ ] TypeScript sem erros
- [ ] Zero dependências externas (puramente local)
