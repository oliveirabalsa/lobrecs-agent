import { BrowserWindow } from 'electron'
import type {
  AgentRuntimeSettings,
  AppSettings,
  AppSettingsPatch,
  EffectiveAppSettings,
  ProjectSettingsOverrides,
  SettingsUpdateEvent,
  SupportedAgentId,
} from '../../../../shared/types'
import { settingsStore } from '../../../store/settings'
import { DEFAULT_APP_SETTINGS } from '../domain/defaultSettings'
import { mergeSettings } from '../domain/mergeSettings'
import {
  normalizeProjectOverrides,
  normalizeSettings,
  normalizeSettingsPatch,
} from '../domain/validateSettings'

export interface SettingsRepository {
  getGlobal(): AppSettings | null
  saveGlobal(settings: AppSettings | AppSettingsPatch): AppSettings
  getProjectOverrides(projectId: string): ProjectSettingsOverrides | null
  saveProjectOverrides(
    projectId: string,
    overrides: AppSettingsPatch | ProjectSettingsOverrides,
  ): ProjectSettingsOverrides
  deleteProjectOverrides(projectId: string): void
}

export class SettingsService {
  constructor(private readonly repository: SettingsRepository = settingsStore) {}

  getGlobal(): AppSettings {
    return this.repository.getGlobal() ?? normalizeSettings(DEFAULT_APP_SETTINGS)
  }

  updateGlobal(input: AppSettingsPatch): AppSettings {
    const current = this.getGlobal()
    const next = normalizeSettings(mergeSettings(current, input))
    const saved = this.repository.saveGlobal(next)
    this.broadcast({
      scope: 'global',
      settings: saved,
      effective: saved,
      updatedAt: Date.now(),
    })

    return saved
  }

  getProjectOverrides(projectId: string): ProjectSettingsOverrides | null {
    return this.repository.getProjectOverrides(projectId)
  }

  updateProjectOverrides(projectId: string, input: AppSettingsPatch): ProjectSettingsOverrides {
    const normalized = normalizeProjectOverrides(projectId, normalizeSettingsPatch(input))
    const saved = this.repository.saveProjectOverrides(projectId, normalized)
    const effective = this.getEffective(projectId).settings
    this.broadcast({
      scope: 'project',
      projectId,
      settings: this.getGlobal(),
      effective,
      updatedAt: saved.updatedAt,
    })

    return saved
  }

  resetProjectOverrides(projectId: string): void {
    this.repository.deleteProjectOverrides(projectId)
    const effective = this.getEffective(projectId).settings
    this.broadcast({
      scope: 'project',
      projectId,
      settings: this.getGlobal(),
      effective,
      updatedAt: Date.now(),
    })
  }

  getEffective(projectId?: string): EffectiveAppSettings {
    const global = this.getGlobal()
    const projectOverrides = projectId ? this.repository.getProjectOverrides(projectId) : null
    const settings = projectOverrides
      ? normalizeSettings(mergeSettings(global, projectOverrides.overrides))
      : global

    return {
      projectId,
      global,
      projectOverrides,
      settings,
    }
  }

  getAgentRuntime(
    agentId: SupportedAgentId,
    projectId?: string,
  ): AgentRuntimeSettings {
    const settings = this.getEffective(projectId).settings
    return settings.agents.runtimes[agentId]
  }

  private broadcast(event: SettingsUpdateEvent): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('settings:updated', event)
        }
      }
    } catch {
      // Unit tests and non-Electron contexts do not have BrowserWindow.
    }
  }
}

export const settingsService = new SettingsService()
