import type {
  AppSettings,
  AppSettingsPatch,
  EffectiveAppSettings,
  ProjectSettingsOverrides,
  SettingsUpdateEvent,
} from '../../../../shared/types'

export const settingsClient = {
  getGlobal(): Promise<AppSettings> {
    return window.agentforge.settings.getGlobal()
  },

  updateGlobal(input: AppSettingsPatch): Promise<AppSettings> {
    return window.agentforge.settings.updateGlobal(input)
  },

  getEffective(projectId?: string): Promise<EffectiveAppSettings> {
    return window.agentforge.settings.getEffective(projectId)
  },

  getProjectOverrides(projectId: string): Promise<ProjectSettingsOverrides | null> {
    return window.agentforge.settings.getProjectOverrides(projectId)
  },

  updateProjectOverrides(
    projectId: string,
    input: AppSettingsPatch,
  ): Promise<ProjectSettingsOverrides> {
    return window.agentforge.settings.updateProjectOverrides(projectId, input)
  },

  resetProjectOverrides(projectId: string): Promise<void> {
    return window.agentforge.settings.resetProjectOverrides(projectId)
  },

  onUpdated(callback: (event: SettingsUpdateEvent) => void): () => void {
    return window.agentforge.settings.onUpdated(callback)
  },
}
