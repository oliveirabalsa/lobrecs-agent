# T-03 · ProjectStore (SQLite)

**Milestone:** M1  
**Depende de:** T-02  
**Pode rodar em paralelo com:** T-05 (ProcessPool) — arquivos distintos  
**Estimativa:** 2–3h  
**Agente sugerido:** claude-sonnet / codex  

---

## Contexto

Persistência local de projetos, sessions e histórico usando SQLite via `better-sqlite3`.  
O banco fica em `userData` do Electron (ex: `~/Library/Application Support/agentforge/db.sqlite`).

---

## O que fazer

### 1. Criar `src/main/store/db.ts` — conexão singleton

```ts
import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const userDataPath = app.getPath('userData')
  fs.mkdirSync(userDataPath, { recursive: true })
  const dbPath = path.join(userDataPath, 'agentforge.sqlite')

  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  runMigrations(_db)
  return _db
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      repo_path   TEXT NOT NULL,
      agent_id    TEXT NOT NULL DEFAULT 'claude-code',
      model_tier  TEXT NOT NULL DEFAULT 'balanced',
      context     TEXT,           -- conteúdo do AGENTS.md do projeto
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id     TEXT NOT NULL,
      model        TEXT NOT NULL,
      prompt       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'running',
      tokens_in    INTEGER NOT NULL DEFAULT 0,
      tokens_out   INTEGER NOT NULL DEFAULT 0,
      cost_usd     REAL NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload    TEXT NOT NULL,  -- JSON
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
  `)
}
```

### 2. Criar `src/main/store/projects.ts`

```ts
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { Project } from '../../shared/types'

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    repoPath: row.repo_path as string,
    agentId: row.agent_id as Project['agentId'],
    modelTier: row.model_tier as Project['modelTier'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const projectsStore = {
  list(): Project[] {
    const rows = getDb()
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[]
    return rows.map(rowToProject)
  },

  get(id: string): Project | null {
    const row = getDb()
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    return row ? rowToProject(row) : null
  },

  create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Project {
    const now = Date.now()
    const id = randomUUID()
    getDb().prepare(`
      INSERT INTO projects (id, name, repo_path, agent_id, model_tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.repoPath, data.agentId, data.modelTier, now, now)
    return this.get(id)!
  },

  update(id: string, data: Partial<Omit<Project, 'id' | 'createdAt'>>): Project {
    const now = Date.now()
    const fields: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.repoPath !== undefined) { fields.push('repo_path = ?'); values.push(data.repoPath) }
    if (data.agentId !== undefined) { fields.push('agent_id = ?'); values.push(data.agentId) }
    if (data.modelTier !== undefined) { fields.push('model_tier = ?'); values.push(data.modelTier) }

    fields.push('updated_at = ?')
    values.push(now, id)

    getDb().prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)!
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  },
}
```

### 3. Criar `src/main/store/sessions.ts`

```ts
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { Session } from '../../shared/types'

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    agentId: row.agent_id as Session['agentId'],
    model: row.model as string,
    prompt: row.prompt as string,
    status: row.status as Session['status'],
    tokensIn: row.tokens_in as number,
    tokensOut: row.tokens_out as number,
    costUsd: row.cost_usd as number,
    createdAt: row.created_at as number,
    completedAt: row.completed_at as number | undefined,
  }
}

export const sessionsStore = {
  list(projectId: string): Session[] {
    const rows = getDb()
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Record<string, unknown>[]
    return rows.map(rowToSession)
  },

  get(id: string): Session | null {
    const row = getDb()
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    return row ? rowToSession(row) : null
  },

  create(data: Omit<Session, 'id' | 'createdAt' | 'tokensIn' | 'tokensOut' | 'costUsd'>): Session {
    const now = Date.now()
    const id = randomUUID()
    getDb().prepare(`
      INSERT INTO sessions (id, project_id, agent_id, model, prompt, status, tokens_in, tokens_out, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
    `).run(id, data.projectId, data.agentId, data.model, data.prompt, data.status, now)
    return this.get(id)!
  },

  updateStatus(id: string, status: Session['status']): void {
    const completedAt = ['done', 'error', 'cancelled'].includes(status) ? Date.now() : null
    getDb().prepare(
      'UPDATE sessions SET status = ?, completed_at = ? WHERE id = ?'
    ).run(status, completedAt, id)
  },

  updateUsage(id: string, tokensIn: number, tokensOut: number, costUsd: number): void {
    getDb().prepare(
      'UPDATE sessions SET tokens_in = ?, tokens_out = ?, cost_usd = ? WHERE id = ?'
    ).run(tokensIn, tokensOut, costUsd, id)
  },
}
```

### 4. Criar barrel `src/main/store/index.ts`

```ts
export { getDb } from './db'
export { projectsStore } from './projects'
export { sessionsStore } from './sessions'
```

### 5. Conectar handlers no IPC

Em `src/main/ipc/index.ts`, substituir os stubs de projects e sessions:

```ts
import { projectsStore, sessionsStore } from '../store'

// dentro de registerIpcHandlers():
ipcMain.handle('projects:list', async () => projectsStore.list())
ipcMain.handle('projects:create', async (_, data) => projectsStore.create(data))
ipcMain.handle('projects:update', async (_, id, data) => projectsStore.update(id, data))
ipcMain.handle('projects:delete', async (_, id) => projectsStore.delete(id))

ipcMain.handle('sessions:list', async (_, projectId) => sessionsStore.list(projectId))
ipcMain.handle('sessions:get', async (_, id) => sessionsStore.get(id))
```

### 6. Escrever testes

Criar `src/main/store/projects.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// Usa banco em memória para testes
function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  // copiar o SQL de migração aqui ou importar a função
  return db
}

describe('projectsStore', () => {
  it('creates and lists a project', () => {
    // implementar com db em memória
    expect(true).toBe(true) // placeholder — expandir com lógica real
  })
})
```

---

## Critérios de aceite (DoD)

- [ ] `getDb()` cria o arquivo SQLite em `userData` na primeira chamada
- [ ] `projectsStore.create()` insere e retorna projeto com id gerado
- [ ] `projectsStore.list()` retorna array ordenado por `updated_at DESC`
- [ ] `projectsStore.update()` atualiza campos parcialmente
- [ ] `projectsStore.delete()` remove projeto e sessions em cascade
- [ ] `sessionsStore.create()` insere session com status 'running'
- [ ] `sessionsStore.updateStatus('done')` preenche `completed_at`
- [ ] Handlers IPC de projects e sessions funcionam (testável via devtools do Electron)
- [ ] TypeScript sem erros
- [ ] Testes passam

---

## Validação

```bash
npx tsc --noEmit
npm test
npm run dev    # abrir devtools, rodar: await window.agentforge.projects.list()
               # deve retornar [] sem erros
```
