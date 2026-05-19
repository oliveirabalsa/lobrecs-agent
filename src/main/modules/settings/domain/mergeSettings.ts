import type { AppSettings, AppSettingsPatch } from '../../../../shared/types'

export function mergeSettings(base: AppSettings, patch: AppSettingsPatch): AppSettings {
  return mergeValue(base, patch) as AppSettings
}

export function cloneSettings(settings: AppSettings): AppSettings {
  return structuredClone(settings)
}

function mergeValue(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return cloneValue(base)
  if (Array.isArray(patch)) return patch.map(cloneValue)
  if (!isPlainObject(base) || !isPlainObject(patch)) return cloneValue(patch)

  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = mergeValue(merged[key], value)
  }

  return merged
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value
  return structuredClone(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
