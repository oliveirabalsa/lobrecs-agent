# T-14 · ModelRouter Engine

**Milestone:** M3  
**Depende de:** T-13  
**Pode rodar em paralelo com:** T-07, T-08 (UI do M2 já finalizado)  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

O ModelRouter combina o ComplexityScorer com o registry de adapters para escolher  
automaticamente qual agente e modelo usar para cada task.

---

## O que fazer

### 1. Criar `src/main/router/ModelRouter.ts`

```ts
import { scoreComplexity } from './ComplexityScorer'
import { adapterRegistry } from '../agents'
import { MODEL_MAP } from '../../shared/types'
import type { ModelTier } from '../../shared/types'

export interface RoutingDecision {
  agentId: string
  model: string
  tier: ModelTier
  score: number
  reasoning: string
}

export class ModelRouter {
  async route(params: {
    prompt: string
    preferredAgentId?: string
    modelOverride?: string
    recentFailures?: Array<{ prompt: string; tier: ModelTier; failed: boolean }>
  }): Promise<RoutingDecision> {
    // Se usuário especificou modelo, usar direto
    if (params.modelOverride) {
      const agentId = params.preferredAgentId ?? 'claude-code'
      return {
        agentId,
        model: params.modelOverride,
        tier: 'balanced',
        score: -1,
        reasoning: 'Manual override',
      }
    }

    // Scoring de complexidade
    const { score, tier, reasoning } = scoreComplexity(params.prompt, {
      recentFailures: params.recentFailures,
    })

    // Selecionar agente preferido ou fallback para claude-code
    let agentId = params.preferredAgentId ?? 'claude-code'

    // Verificar se o agente está instalado; fallback se não
    const adapter = adapterRegistry.get(agentId)
    if (!adapter || !(await adapter.isInstalled())) {
      agentId = 'claude-code'
    }

    // Para tier frontier, usar sempre claude-code ou codex (mais confiável)
    if (tier === 'frontier' && agentId === 'opencode') {
      agentId = 'claude-code'
    }

    const model = MODEL_MAP[agentId]?.[tier] ?? MODEL_MAP['claude-code'][tier]

    return { agentId, model, tier, score, reasoning }
  }
}

export const modelRouter = new ModelRouter()
```

### 2. Integrar no `SessionManager`

Em `src/main/session/SessionManager.ts`, substituir o modelo hardcoded:

```ts
import { modelRouter } from '../router/ModelRouter'

// No método dispatch():
const decision = await modelRouter.route({
  prompt: params.prompt,
  preferredAgentId: params.agentId,
  modelOverride: params.modelOverride,
})

// Usar decision.agentId e decision.model
```

### 3. Expor routing via IPC (para o renderer mostrar o modelo sugerido em tempo real)

```ts
// Em ipc/index.ts
ipcMain.handle('router:preview', async (_, prompt: string, projectId: string) => {
  const project = projectsStore.get(projectId)
  const decision = await modelRouter.route({
    prompt,
    preferredAgentId: project?.agentId,
  })
  return decision
})
```

No preload:
```ts
router: {
  preview: (prompt: string, projectId: string): Promise<RoutingDecision> =>
    ipcRenderer.invoke('router:preview', prompt, projectId),
}
```

### 4. Testes

```ts
// src/main/router/ModelRouter.test.ts
import { describe, it, expect } from 'vitest'
import { ModelRouter } from './ModelRouter'

describe('ModelRouter', () => {
  const router = new ModelRouter()

  it('uses override model when specified', async () => {
    const decision = await router.route({
      prompt: 'anything',
      modelOverride: 'claude-opus-4-6',
    })
    expect(decision.model).toBe('claude-opus-4-6')
    expect(decision.reasoning).toContain('Manual override')
  })

  it('routes simple task to lightweight', async () => {
    const decision = await router.route({ prompt: 'fix typo in README' })
    expect(decision.tier).toBe('lightweight')
  })
})
```

---

## Critérios de aceite (DoD)

- [ ] `modelRouter.route()` retorna decisão completa com agentId, model, tier, reasoning
- [ ] Manual override respeita o modelo especificado
- [ ] Fallback para claude-code se agente preferido não instalado
- [ ] Handler `router:preview` disponível via IPC
- [ ] Integrado no SessionManager (substitui modelo hardcoded)
- [ ] Testes passam
- [ ] TypeScript sem erros

---
---

# T-15 · Router UI (model indicator no TaskInput)

**Milestone:** M3  
**Depende de:** T-14, T-07  
**Pode rodar em paralelo com:** T-12  
**Estimativa:** 2h  
**Agente sugerido:** claude-haiku  

---

## Contexto

Mostrar em tempo real qual modelo o router vai usar, enquanto o usuário digita a task.  
Pequeno indicador abaixo do TaskInput com debounce de 500ms.

---

## O que fazer

### 1. Atualizar `TaskInput` com indicador de modelo

```tsx
import { useState, useEffect } from 'react'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

// Dentro do TaskInput:
const [routingDecision, setRoutingDecision] = useState<RoutingDecision | null>(null)
const debouncedPrompt = useDebouncedValue(prompt, 500)

useEffect(() => {
  if (!debouncedPrompt.trim() || !projectId) return
  window.agentforge.router.preview(debouncedPrompt, projectId)
    .then(setRoutingDecision)
}, [debouncedPrompt, projectId])
```

### 2. Criar `src/renderer/hooks/useDebouncedValue.ts`

```ts
import { useState, useEffect } from 'react'

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
```

### 3. Componente `ModelBadge`

```tsx
// Exibir tier + modelo abaixo do textarea
// ex: "⚡ lightweight · claude-haiku-4-5" | "🧠 frontier · claude-opus-4-6"

const TIER_ICONS = {
  lightweight: '⚡',
  balanced: '⚖️',
  advanced: '🔬',
  frontier: '🧠',
}
```

### 4. Dropdown de override

Ao clicar no ModelBadge, abre dropdown com modelos disponíveis para override manual:
- Auto (padrão)
- claude-haiku-4-5 (lightweight)
- claude-sonnet-4-6 (balanced)
- claude-opus-4-6 (advanced/frontier)
- gpt-5.2-codex (se codex instalado)
- minimax (se opencode instalado)

---

## Critérios de aceite (DoD)

- [ ] ModelBadge aparece abaixo do textarea com debounce 500ms
- [ ] Atualiza ao digitar (não a cada keystroke)
- [ ] Exibe tier + model name
- [ ] Dropdown de override funciona e passa `modelOverride` no dispatch
- [ ] Se override selecionado, badge muda para mostrar "Manual: claude-opus-4-6"
- [ ] TypeScript sem erros

---
---

# T-16 · Feedback Loop (router learning)

**Milestone:** M3  
**Depende de:** T-14, T-03  
**Pode rodar em paralelo com:** T-15  
**Estimativa:** 2h  
**Agente sugerido:** claude-haiku  

---

## Contexto

Quando uma task falha (agente retorna erro ou não entrega resultado útil), o usuário pode marcar como "falhou".  
O router usa esse histórico para evitar sub-alocar tarefas similares no futuro.

---

## O que fazer

### 1. Adicionar tabela `session_feedback` no schema SQLite

Em `src/main/store/db.ts`, adicionar na migração:

```sql
CREATE TABLE IF NOT EXISTS session_feedback (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(id),
  outcome     TEXT NOT NULL,  -- 'success' | 'failure' | 'partial'
  user_note   TEXT,
  created_at  INTEGER NOT NULL
);
```

### 2. Criar `src/main/store/feedback.ts`

```ts
import { getDb } from './db'

export const feedbackStore = {
  save(sessionId: string, outcome: 'success' | 'failure' | 'partial', note?: string) {
    getDb().prepare(`
      INSERT OR REPLACE INTO session_feedback (session_id, outcome, user_note, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, outcome, note ?? null, Date.now())
  },

  getRecentFailures(projectId: string, limit = 20) {
    return getDb().prepare(`
      SELECT s.prompt, s.model, sf.outcome
      FROM sessions s
      JOIN session_feedback sf ON sf.session_id = s.id
      WHERE s.project_id = ?
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(projectId, limit) as Array<{ prompt: string; model: string; outcome: string }>
  },
}
```

### 3. Botões de feedback na SessionHeader

Após session completar (status `done`), mostrar:
```
Resultado útil? [👍 Sim] [👎 Não]
```

Ao clicar "Não", opcionalmente mostrar campo de nota.

### 4. Handler IPC

```ts
ipcMain.handle('feedback:save', async (_, sessionId: string, outcome: string, note?: string) => {
  feedbackStore.save(sessionId, outcome as never, note)
})
```

### 5. Integrar no ModelRouter

```ts
// No route(), buscar failures recentes do projeto
const recentFailures = feedbackStore.getRecentFailures(projectId)
  .filter(f => f.outcome === 'failure')
  .map(f => ({
    prompt: f.prompt,
    tier: modelTierFromModel(f.model),
    failed: true,
  }))
```

---

## Critérios de aceite (DoD)

- [ ] Tabela `session_feedback` criada na migração
- [ ] Botões 👍/👎 aparecem após session completar
- [ ] Feedback salvo no banco via IPC
- [ ] `feedbackStore.getRecentFailures()` retorna sessions com outcome failure
- [ ] ModelRouter usa failures para aumentar score de tarefas similares
- [ ] TypeScript sem erros
