import type { AppSettings, AppSettingsPatch, ProjectSettingsOverrides } from '../../shared/types'
import {
  normalizeProjectOverrides,
  normalizeSettings,
} from '../modules/settings/domain/validateSettings'
import { getDb } from './db'

type SettingsRow = {
  value: string
  updated_at: number
}

export const settingsStore = {
  getGlobal(): AppSettings | null {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE id = ?').get('global') as
      | Pick<SettingsRow, 'value'>
      | undefined

    if (!row) return null
    return normalizeSettings(parseJson(row.value))
  },

  saveGlobal(settings: AppSettings | AppSettingsPatch): AppSettings {
    const now = Date.now()
    const normalized = normalizeSettings(settings)
    const value = JSON.stringify(normalized)

    getDb()
      .prepare(
        `
          INSERT INTO app_settings (id, value, created_at, updated_at)
          VALUES ('global', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `,
      )
      .run(value, now, now)

    return normalized
  },

  getProjectOverrides(projectId: string): ProjectSettingsOverrides | null {
    const row = getDb()
      .prepare('SELECT value, updated_at FROM project_settings WHERE project_id = ?')
      .get(projectId) as SettingsRow | undefined

    if (!row) return null
    return normalizeProjectOverrides(projectId, parseJson(row.value), row.updated_at)
  },

  saveProjectOverrides(
    projectId: string,
    overrides: AppSettingsPatch | ProjectSettingsOverrides,
  ): ProjectSettingsOverrides {
    const now = Date.now()
    const normalized = normalizeProjectOverrides(projectId, overrides, now)
    const value = JSON.stringify(normalized.overrides)

    getDb()
      .prepare(
        `
          INSERT INTO project_settings (project_id, value, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `,
      )
      .run(projectId, value, now, now)

    return normalized
  },

  deleteProjectOverrides(projectId: string): void {
    getDb().prepare('DELETE FROM project_settings WHERE project_id = ?').run(projectId)
  },
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return {}
  }
}
