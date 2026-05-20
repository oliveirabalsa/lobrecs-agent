import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, runMigrations } from './db'

describe('database migrations', () => {
  afterEach(() => {
    closeDb()
  })

  it('migrates legacy Gemini agent ids to Antigravity', () => {
    const db = new Database(':memory:')

    try {
      db.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
        INSERT INTO schema_version (version) VALUES (1), (2), (3), (4), (5), (6);

        CREATE TABLE projects (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL);
        CREATE TABLE automations (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL);
        CREATE TABLE run_attempts (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL);
        CREATE TABLE specs (id TEXT PRIMARY KEY, selected_agents TEXT NOT NULL);
        CREATE TABLE app_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE project_settings (project_id TEXT PRIMARY KEY, value TEXT NOT NULL);

        INSERT INTO projects (id, agent_id) VALUES ('project-1', 'gemini');
        INSERT INTO sessions (id, agent_id) VALUES ('session-1', 'gemini');
        INSERT INTO automations (id, agent_id) VALUES ('automation-1', 'gemini');
        INSERT INTO run_attempts (id, agent_id) VALUES ('attempt-1', 'gemini');
        INSERT INTO specs (id, selected_agents) VALUES ('spec-1', '["codex","gemini"]');
        INSERT INTO app_settings (id, value)
          VALUES ('global', '{"agents":{"defaultAgentId":"gemini","enabledAgentIds":["gemini"]}}');
        INSERT INTO project_settings (project_id, value)
          VALUES ('project-1', '{"agents":{"runtimes":{"gemini":{"enabled":false}}}}');
      `)

      runMigrations(db)

      expect(singleValue(db, 'SELECT agent_id FROM projects WHERE id = ?', 'project-1')).toBe(
        'antigravity',
      )
      expect(singleValue(db, 'SELECT agent_id FROM sessions WHERE id = ?', 'session-1')).toBe(
        'antigravity',
      )
      expect(singleValue(db, 'SELECT agent_id FROM automations WHERE id = ?', 'automation-1')).toBe(
        'antigravity',
      )
      expect(singleValue(db, 'SELECT agent_id FROM run_attempts WHERE id = ?', 'attempt-1')).toBe(
        'antigravity',
      )
      expect(singleValue(db, 'SELECT selected_agents FROM specs WHERE id = ?', 'spec-1')).toBe(
        '["codex","antigravity"]',
      )
      expect(singleValue(db, 'SELECT value FROM app_settings WHERE id = ?', 'global')).toBe(
        '{"agents":{"defaultAgentId":"antigravity","enabledAgentIds":["antigravity"]}}',
      )
      expect(
        singleValue(db, 'SELECT value FROM project_settings WHERE project_id = ?', 'project-1'),
      ).toBe('{"agents":{"runtimes":{"antigravity":{"enabled":false}}}}')
    } finally {
      db.close()
    }
  })
})

function singleValue(db: Database.Database, sql: string, id: string): unknown {
  const row = db.prepare(sql).get(id) as Record<string, unknown> | undefined
  return row ? Object.values(row)[0] : undefined
}
