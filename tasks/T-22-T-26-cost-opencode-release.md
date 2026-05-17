# T-22 · CostTracker

**Milestone:** M5  
**Depende de:** T-08 (SessionManager)  
**Pode rodar em paralelo com:** T-17, T-21, T-24, T-25  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-haiku / codex  

---

## Contexto

Rastrear custo por session, por projeto e por período.  
Os agentes reportam usage (tokens in/out) nos eventos — o CostTracker converte para USD.

---

## O que fazer

### 1. Criar `src/main/cost/pricing.ts`

```ts
// Preços por milhão de tokens (USD) — atualizar conforme pricing oficial
export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-sonnet-4-6':         { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-6':           { inputPer1M: 15.00, outputPer1M: 75.00 },
  'gpt-5.2-codex':             { inputPer1M: 0.50, outputPer1M: 2.50 },
  'gpt-5.4':                   { inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-5.5':                   { inputPer1M: 5.00, outputPer1M: 20.00 },
  'minimax':                   { inputPer1M: 0.10, outputPer1M: 0.30 },
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  return (tokensIn / 1_000_000) * pricing.inputPer1M +
         (tokensOut / 1_000_000) * pricing.outputPer1M
}

export function estimateFromPrompt(model: string, promptLength: number): number {
  // Estimativa grosseira: ~0.75 tokens por caractere (para preview antes de rodar)
  const estimatedTokens = Math.ceil(promptLength * 0.75)
  return estimateCost(model, estimatedTokens, estimatedTokens * 3)
}
```

### 2. Atualizar SessionManager para capturar usage

Nos eventos dos adapters, quando o output contém `usage` (input_tokens + output_tokens):

```ts
// Em SessionManager, dentro do handler de eventos:
if (event.type === 'session-complete') {
  const usage = (event.payload as Record<string, unknown>).usage as
    { input_tokens?: number; output_tokens?: number } | undefined

  if (usage) {
    const tokensIn = usage.input_tokens ?? 0
    const tokensOut = usage.output_tokens ?? 0
    const costUsd = estimateCost(session.model, tokensIn, tokensOut)
    sessionsStore.updateUsage(session.id, tokensIn, tokensOut, costUsd)
  }
}
```

### 3. Criar `src/main/ipc/cost.ts`

```ts
import { getDb } from '../store/db'

export function registerCostHandlers() {
  ipcMain.handle('cost:by-project', async (_, projectId: string) => {
    return getDb().prepare(`
      SELECT
        SUM(tokens_in)  as total_tokens_in,
        SUM(tokens_out) as total_tokens_out,
        SUM(cost_usd)   as total_cost_usd,
        COUNT(*)        as session_count
      FROM sessions
      WHERE project_id = ?
    `).get(projectId)
  })

  ipcMain.handle('cost:by-period', async (_, days: number) => {
    const since = Date.now() - (days * 24 * 60 * 60 * 1000)
    return getDb().prepare(`
      SELECT
        p.name as project_name,
        s.model,
        COUNT(s.id) as sessions,
        SUM(s.cost_usd) as total_cost
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.created_at >= ?
      GROUP BY p.id, s.model
      ORDER BY total_cost DESC
    `).all(since)
  })
}
```

---

## Critérios de aceite (DoD)

- [ ] `MODEL_PRICING` tem preços para todos os modelos suportados
- [ ] `estimateCost()` calcula corretamente (testável via unit test)
- [ ] SessionManager atualiza custo ao receber `session-complete` com usage
- [ ] Handlers `cost:by-project` e `cost:by-period` funcionam
- [ ] Custo exibido na SessionHeader ("~$0.003")
- [ ] TypeScript sem erros

---
---

# T-23 · CostDashboard UI

**Milestone:** M5  
**Depende de:** T-22  
**Pode rodar em paralelo com:** T-24, T-25, T-26  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-haiku  

---

## Contexto

Tela de resumo de custos acessível via sidebar ou menu.  
Simples, sem dependência de biblioteca de charts — usar CSS bars.

---

## O que fazer

### 1. Criar `src/renderer/components/CostDashboard/index.tsx`

Seções:
- **Resumo do mês**: total gasto, total tokens, sessions count
- **Por projeto**: bar chart simples (CSS width % do max) com nome + valor
- **Por modelo**: idem
- **Seletor de período**: botões "7d | 30d | 90d"
- **Export CSV**: botão que baixa os dados

### 2. CSS bar chart (sem biblioteca)

```tsx
function CostBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-32 text-xs text-zinc-400 truncate">{label}</span>
      <div className="flex-1 bg-zinc-800 rounded-full h-2">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 text-xs text-zinc-300 text-right">
        ${value.toFixed(4)}
      </span>
    </div>
  )
}
```

### 3. Export CSV

```ts
function exportCSV(rows: CostRow[]) {
  const csv = [
    'project,model,sessions,cost_usd',
    ...rows.map(r => `${r.project_name},${r.model},${r.sessions},${r.total_cost.toFixed(6)}`),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `agentforge-costs-${Date.now()}.csv`
  a.click()
}
```

---

## Critérios de aceite (DoD)

- [ ] Dashboard carrega dados reais do banco
- [ ] Seletor de período funciona (7d / 30d / 90d)
- [ ] CSS bars proporcionais ao valor máximo
- [ ] Export CSV funciona
- [ ] Sem erros quando não há dados (empty state)
- [ ] TypeScript sem erros

---
---

# T-24 · OpenCode Adapter (Minimax)

**Milestone:** M5 (mas pode ser M2/M3 se urgente)  
**Depende de:** T-05 (ProcessPool)  
**Pode rodar em paralelo com:** T-07, T-08, T-11, T-17 — qualquer task de outra camada  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Adapter para o OpenCode CLI que já está configurado com Minimax na sua conta.  
OpenCode usa o mesmo padrão de CLI: `opencode <prompt>` com output em texto/JSON.

---

## O que fazer

### 1. Criar `src/main/agents/OpenCodeAdapter.ts`

```ts
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { processPool } from '../process/ProcessPool'
import type { AgentAdapter, AgentSession } from './AgentAdapter'

const execAsync = promisify(exec)

export class OpenCodeAdapter implements AgentAdapter {
  id = 'opencode'
  name = 'OpenCode'

  async isInstalled(): Promise<boolean> {
    try {
      await execAsync('which opencode')
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

    // OpenCode usa modelo via --model flag ou config ~/.opencode/config.toml
    // Minimax já deve estar configurado via sua conta
    const args = [
      '--model', params.model === 'minimax' ? 'minimax' : params.model,
      params.prompt,
    ]

    const child = processPool.spawn(params.sessionId, 'opencode', args, {
      cwd: params.repoPath,
    })

    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      events.emit('event', {
        type: 'stdout',
        sessionId: params.sessionId,
        payload: { text: line + '\n' },
        timestamp: Date.now(),
      })
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      events.emit('event', {
        type: 'stderr',
        sessionId: params.sessionId,
        payload: { text: chunk.toString() },
        timestamp: Date.now(),
      })
    })

    child.on('exit', (code) => {
      events.emit('event', {
        type: 'session-complete',
        sessionId: params.sessionId,
        payload: { exitCode: code },
        timestamp: Date.now(),
      })
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
```

### 2. Registrar no adapterRegistry

```ts
import { OpenCodeAdapter } from './OpenCodeAdapter'

export const adapterRegistry = new Map([
  ['claude-code', new ClaudeCodeAdapter()],
  ['codex', new CodexAdapter()],
  ['opencode', new OpenCodeAdapter()],
])
```

### 3. Detectar instalação no startup

Em `src/main/index.ts`, exibir no log quais adapters estão disponíveis para o usuário.

---

## Critérios de aceite (DoD)

- [ ] `OpenCodeAdapter.isInstalled()` funciona
- [ ] `dispatch()` spawna `opencode` com args corretos
- [ ] Adapter registrado no `adapterRegistry`
- [ ] Aparece nas opções de agente no NewProjectModal
- [ ] `MODEL_MAP['opencode']` retorna modelos corretos
- [ ] TypeScript sem erros

---
---

# T-25 · Automations Engine

**Milestone:** M5  
**Depende de:** T-08 (SessionManager), T-12 (history)  
**Pode rodar em paralelo com:** T-22, T-23, T-24  
**Estimativa:** 3–4h  
**Agente sugerido:** claude-sonnet  

---

## Contexto

Tasks recorrentes agendadas (cron-style). O output vai para uma review queue,  
não é aplicado automaticamente. Inspirado nas Automations do Codex app.

---

## O que fazer

### 1. Adicionar tabela `automations` no schema

```sql
CREATE TABLE IF NOT EXISTS automations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  schedule    TEXT NOT NULL,  -- cron expression: '0 9 * * 1-5' = 9h em dias úteis
  agent_id    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at  INTEGER NOT NULL
);
```

### 2. Criar `src/main/automation/AutomationScheduler.ts`

```ts
// Usar node-cron ou implementar scheduler simples com setInterval
// Para MVP: verificar a cada minuto se alguma automation deve rodar

import { getDb } from '../store/db'
import { sessionManager } from '../session/SessionManager'
import { projectsStore } from '../store'

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null

  start() {
    this.timer = setInterval(() => this.tick(), 60_000)  // check a cada minuto
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick() {
    const now = Date.now()
    const automations = getDb()
      .prepare(`SELECT * FROM automations WHERE enabled = 1`)
      .all() as Automation[]

    for (const automation of automations) {
      if (this.shouldRun(automation, now)) {
        await this.run(automation)
      }
    }
  }

  private shouldRun(automation: Automation, now: number): boolean {
    // Implementação simplificada de cron matching
    // Para MVP: usar biblioteca 'cron-parser' (adicionar à dep list)
    // Verificar se o cron expression "dispara" no minuto atual
    return false  // TODO: implementar com cron-parser
  }

  private async run(automation: Automation) {
    const project = projectsStore.get(automation.project_id)
    if (!project) return

    getDb()
      .prepare('UPDATE automations SET last_run_at = ? WHERE id = ?')
      .run(Date.now(), automation.id)

    await sessionManager.dispatch({
      projectId: automation.project_id,
      prompt: `[Automation: ${automation.name}]\n${automation.prompt}`,
      agentId: automation.agent_id,
      model: 'claude-sonnet-4-6',
      repoPath: project.repoPath,
    })
  }
}

type Automation = {
  id: string; project_id: string; name: string; prompt: string
  schedule: string; agent_id: string; enabled: number; last_run_at: number | null
}

export const automationScheduler = new AutomationScheduler()
```

### 3. UI básica: Automation Manager

Tela simples (acessível via menu) com:
- Lista de automations por projeto
- Criar automation: nome, prompt, schedule (preset buttons: daily 9h, weekly monday, hourly)
- Toggle enable/disable
- "Run now" para testar
- Histórico das últimas execuções

---

## Critérios de aceite (DoD)

- [ ] Tabela `automations` criada na migração
- [ ] `AutomationScheduler.start()` iniciado no app startup
- [ ] CRUD de automations via IPC
- [ ] UI lista automations com toggle
- [ ] "Run now" dispara session imediatamente
- [ ] TypeScript sem erros

---
---

# T-26 · macOS Build, Sign e Release Config

**Milestone:** M5  
**Depende de:** T-01 (scaffold)  
**Pode rodar em paralelo com:** qualquer tarefa de feature  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-haiku / codex  

---

## Contexto

Configurar electron-builder para gerar builds macOS (.dmg) e Windows (.exe).  
Signing e notarization para macOS (evitar Gatekeeper warning).

---

## O que fazer

### 1. Criar `electron-builder.yml`

```yaml
appId: com.agentforge.app
productName: AgentForge
copyright: Copyright © 2026

directories:
  output: dist-electron

files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}'

mac:
  category: public.app-category.developer-tools
  icon: resources/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  target:
    - dmg
    - zip

dmg:
  title: AgentForge ${version}

win:
  icon: resources/icon.ico
  target:
    - nsis

linux:
  target:
    - AppImage
  category: Development

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### 2. Criar `resources/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <!-- Necessário para node-pty e processos CLI -->
    <key>com.apple.security.inherit</key>
    <true/>
  </dict>
</plist>
```

### 3. Scripts de build em `package.json`

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "build:mac": "npm run build && electron-builder --mac",
    "build:win": "npm run build && electron-builder --win",
    "build:linux": "npm run build && electron-builder --linux",
    "release": "npm run build && electron-builder --publish always"
  }
}
```

### 4. Configurar auto-updater

Em `src/main/index.ts`:
```ts
import { autoUpdater } from 'electron-updater'

if (!isDev) {
  autoUpdater.checkForUpdatesAndNotify()
}
```

### 5. Configurar CI/CD básico (opcional — GitHub Actions)

Criar `.github/workflows/release.yml` que:
- Roda em push de tag `v*`
- Builda para macOS, Windows e Linux
- Faz upload dos artifacts como GitHub Release

---

## Critérios de aceite (DoD)

- [ ] `npm run build:mac` gera `.dmg` sem erros
- [ ] `npm run build:win` gera `.exe` sem erros (no CI)
- [ ] `entitlements.mac.plist` correto para node-pty funcionar após signing
- [ ] Auto-updater configurado (não precisa estar funcional sem certificado)
- [ ] GitHub Actions workflow criado
- [ ] TypeScript sem erros no build de produção
