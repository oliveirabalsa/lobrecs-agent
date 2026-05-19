export { settingsService, SettingsService } from './application/settingsService'
export { DEFAULT_APP_SETTINGS, DEFAULT_VERIFICATION_RECIPES } from './domain/defaultSettings'
export { mergeSettings } from './domain/mergeSettings'
export {
  normalizeProjectOverrides,
  normalizeSettings,
  normalizeSettingsPatch,
} from './domain/validateSettings'
export { registerSettingsHandlers } from './ipc/registerSettingsHandlers'
