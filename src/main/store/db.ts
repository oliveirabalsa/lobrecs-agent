import Database from 'better-sqlite3'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const DB_FILE_NAME = 'agentforge.sqlite'

let dbInstance: Database.Database | null = null

type Migration = {
  version: number
  up: string
}

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        repo_path   TEXT NOT NULL,
        agent_id    TEXT NOT NULL DEFAULT 'claude-code',
        model_tier  TEXT NOT NULL DEFAULT 'balanced',
        context     TEXT,
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
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_feedback (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        outcome    TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'partial')),
        user_note  TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automations (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        prompt      TEXT NOT NULL,
        schedule    TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_run_at INTEGER,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON session_feedback(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id, enabled);
    `,
  },
]

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance

  const userDataPath = getElectronUserDataPath()
  fs.mkdirSync(userDataPath, { recursive: true })

  dbInstance = new Database(path.join(userDataPath, DB_FILE_NAME))
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('foreign_keys = ON')
  runMigrations(dbInstance)

  return dbInstance
}

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')

  const applied = new Set(
    (
      db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>
    ).map((row) => row.version),
  )
  const pending = migrations.filter((migration) => !applied.has(migration.version))

  const migrate = db.transaction((items: Migration[]) => {
    for (const migration of items) {
      db.exec(migration.up)
      db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(
        migration.version,
      )
    }
  })

  migrate(pending)
}

export function setDbForTests(db: Database.Database | null): void {
  closeDb()
  dbInstance = db
  if (!dbInstance) return

  dbInstance.pragma('foreign_keys = ON')
  runMigrations(dbInstance)
}

export function closeDb(): void {
  if (!dbInstance) return

  const db = dbInstance
  dbInstance = null

  try {
    if (db.open) {
      db.close()
    }
  } catch {
    // Tests may close their in-memory DB explicitly; keep cleanup idempotent.
  }
}

function getElectronUserDataPath(): string {
  const electron = require('electron') as {
    app?: { getPath(name: 'userData'): string }
  }

  if (!electron.app?.getPath) {
    throw new Error('Electron app is not available. Use setDbForTests() in unit tests.')
  }

  return electron.app.getPath('userData')
}
