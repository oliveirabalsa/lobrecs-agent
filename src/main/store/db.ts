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
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS specs (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        goal            TEXT NOT NULL,
        context         TEXT NOT NULL DEFAULT '',
        constraints     TEXT NOT NULL DEFAULT '',
        done_when       TEXT NOT NULL DEFAULT '',
        target_files    TEXT NOT NULL DEFAULT '[]',
        selected_agents TEXT NOT NULL DEFAULT '[]',
        run_mode        TEXT NOT NULL DEFAULT 'local',
        status          TEXT NOT NULL DEFAULT 'draft',
        approved_at     INTEGER,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spec_requirements (
        id        TEXT PRIMARY KEY,
        spec_id   TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
        body      TEXT NOT NULL,
        position  INTEGER NOT NULL,
        satisfied INTEGER NOT NULL DEFAULT 0 CHECK (satisfied IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS spec_acceptance_criteria (
        id       TEXT PRIMARY KEY,
        spec_id  TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
        body     TEXT NOT NULL,
        position INTEGER NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS spec_runs (
        id           TEXT PRIMARY KEY,
        spec_id      TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
        status       TEXT NOT NULL DEFAULT 'queued',
        mode         TEXT NOT NULL DEFAULT 'local',
        created_at   INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS run_attempts (
        id           TEXT PRIMARY KEY,
        spec_run_id  TEXT NOT NULL REFERENCES spec_runs(id) ON DELETE CASCADE,
        session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        agent_id     TEXT NOT NULL,
        model        TEXT,
        status       TEXT NOT NULL DEFAULT 'queued',
        cost_usd     REAL,
        duration_ms  INTEGER,
        risk         TEXT,
        created_at   INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS verification_results (
        id           TEXT PRIMARY KEY,
        spec_run_id  TEXT NOT NULL REFERENCES spec_runs(id) ON DELETE CASCADE,
        command      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        output       TEXT,
        created_at   INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_specs_project ON specs(project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_requirements_spec ON spec_requirements(spec_id, position);
      CREATE INDEX IF NOT EXISTS idx_criteria_spec ON spec_acceptance_criteria(spec_id, position);
      CREATE INDEX IF NOT EXISTS idx_spec_runs_spec ON spec_runs(spec_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_attempts_run ON run_attempts(spec_run_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_verification_results_run ON verification_results(spec_run_id, created_at ASC);
    `,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS threads (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        title           TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        pinned          INTEGER NOT NULL DEFAULT 0,
        last_session_id TEXT,
        archived_at     INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
      CREATE INDEX IF NOT EXISTS idx_threads_project_updated
        ON threads(project_id, updated_at DESC);
    `,
  },
  {
    version: 4,
    up: `
      UPDATE specs SET run_mode = 'local' WHERE run_mode <> 'local';
      UPDATE spec_runs SET mode = 'local' WHERE mode <> 'local';
    `,
  },
  {
    version: 5,
    up: `
      CREATE TABLE IF NOT EXISTS app_settings (
        id         TEXT PRIMARY KEY CHECK(id = 'global'),
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 6,
    up: `
      ALTER TABLE sessions ADD COLUMN image_attachments TEXT;
    `,
  },
  {
    version: 7,
    up: `
      UPDATE projects SET agent_id = 'antigravity' WHERE agent_id = 'gemini';
      UPDATE sessions SET agent_id = 'antigravity' WHERE agent_id = 'gemini';
      UPDATE automations SET agent_id = 'antigravity' WHERE agent_id = 'gemini';
      UPDATE run_attempts SET agent_id = 'antigravity' WHERE agent_id = 'gemini';
      UPDATE specs
        SET selected_agents = REPLACE(selected_agents, '"gemini"', '"antigravity"')
        WHERE selected_agents LIKE '%"gemini"%';
      UPDATE app_settings
        SET value = REPLACE(value, '"gemini"', '"antigravity"')
        WHERE value LIKE '%"gemini"%';
      UPDATE project_settings
        SET value = REPLACE(value, '"gemini"', '"antigravity"')
        WHERE value LIKE '%"gemini"%';
    `,
  },
  {
    version: 8,
    up: `
      CREATE TABLE IF NOT EXISTS project_context_chunks (
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path         TEXT NOT NULL,
        start_line   INTEGER NOT NULL,
        end_line     INTEGER NOT NULL,
        content      TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding    TEXT NOT NULL,
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (project_id, path, start_line, end_line)
      );

      CREATE INDEX IF NOT EXISTS idx_project_context_chunks_project
        ON project_context_chunks(project_id, updated_at DESC);
    `,
  },
  {
    version: 9,
    up: `
      ALTER TABLE sessions ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 10,
    up: `
      CREATE TABLE IF NOT EXISTS run_audit_records (
        id                TEXT PRIMARY KEY,
        spec_run_id       TEXT REFERENCES spec_runs(id) ON DELETE CASCADE,
        session_id        TEXT NOT NULL,
        thread_id         TEXT,
        attempt           INTEGER NOT NULL DEFAULT 0,
        phase             TEXT NOT NULL,
        recipe_id         TEXT,
        recipe_label      TEXT,
        command           TEXT,
        exit_code         INTEGER,
        output_tail       TEXT,
        changed_files     TEXT,
        repair_session_id TEXT,
        stop_reason       TEXT,
        final_status      TEXT,
        created_at        INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_run_audit_records_run
        ON run_audit_records(spec_run_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_run_audit_records_session
        ON run_audit_records(session_id, created_at ASC);
    `,
  },
  {
    version: 11,
    up: `
      CREATE TABLE IF NOT EXISTS prompt_evidence_records (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
        project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id        TEXT,
        agent_id         TEXT NOT NULL,
        model            TEXT NOT NULL,
        prompt           TEXT NOT NULL,
        resolved_context TEXT,
        adapter_context  TEXT,
        context_bytes    INTEGER NOT NULL DEFAULT 0,
        redacted         INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0, 1)),
        created_at       INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_evidence_session
        ON prompt_evidence_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_evidence_project
        ON prompt_evidence_records(project_id, created_at DESC);
    `,
  },
  {
    version: 12,
    up: `
      CREATE TABLE IF NOT EXISTS extension_installations (
        id            TEXT PRIMARY KEY,
        extension_id  TEXT NOT NULL,
        scope         TEXT NOT NULL CHECK (scope IN ('global', 'project')),
        project_path  TEXT,
        target_agents TEXT NOT NULL,
        actions       TEXT NOT NULL,
        installed_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_extension_installations_extension
        ON extension_installations(extension_id, installed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_extension_installations_scope
        ON extension_installations(scope, installed_at DESC);
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

  // SQLite ADD COLUMN is not idempotent; wrap in try/catch so re-running on an
  // already-migrated database is safe regardless of schema_version state.
  ensureSessionsCompatibilityColumns(db)
}

function ensureSessionsCompatibilityColumns(db: Database.Database): void {
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN thread_id TEXT')
  } catch {
    // Column already exists.
  }

  try {
    db.exec('ALTER TABLE sessions ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0')
  } catch {
    // Column already exists.
  }
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
