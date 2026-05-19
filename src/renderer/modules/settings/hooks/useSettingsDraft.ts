import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, AppSettingsPatch, Project } from '../../../../shared/types'
import { settingsClient } from '../api/settingsClient'

export type SettingsScope = 'global' | 'project'

interface UseSettingsDraftInput {
  project: Project | null
}

export function useSettingsDraft({ project }: UseSettingsDraftInput) {
  const [scope, setScope] = useState<SettingsScope>('global')
  const [globalSettings, setGlobalSettings] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const projectId = scope === 'project' ? project?.id : undefined

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const [global, effective] = await Promise.all([
        settingsClient.getGlobal(),
        settingsClient.getEffective(projectId),
      ])
      setGlobalSettings(global)
      setDraft(effective.settings)
      setJsonText(JSON.stringify(effective.settings, null, 2))
      setDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (scope === 'project' && !project) {
      setScope('global')
      return
    }
    void load()
  }, [load, project, scope])

  const updateDraft = useCallback((updater: (current: AppSettings) => AppSettings) => {
    setDraft((current) => {
      if (!current) return current
      const next = updater(current)
      setJsonText(JSON.stringify(next, null, 2))
      setDirty(true)
      return next
    })
  }, [])

  const applyJson = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as AppSettings
      setDraft(parsed)
      setDirty(true)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invalid JSON')
    }
  }, [jsonText])

  const save = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (scope === 'project' && project && globalSettings) {
        await settingsClient.updateProjectOverrides(
          project.id,
          (diffSettingsForProjectOverrides(globalSettings, draft) ?? {}) as AppSettingsPatch,
        )
      } else {
        await settingsClient.updateGlobal(draft)
      }
      setNotice('Settings saved.')
      setDirty(false)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [draft, globalSettings, load, project, scope])

  const reset = useCallback(async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (scope === 'project' && project) {
        await settingsClient.resetProjectOverrides(project.id)
        setNotice('Project overrides reset.')
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to reset settings')
    } finally {
      setSaving(false)
    }
  }, [load, project, scope])

  return useMemo(
    () => ({
      scope,
      setScope,
      globalSettings,
      draft,
      updateDraft,
      jsonText,
      setJsonText,
      applyJson,
      dirty,
      loading,
      saving,
      error,
      notice,
      save,
      reset,
      reload: load,
    }),
    [
      applyJson,
      dirty,
      draft,
      error,
      globalSettings,
      jsonText,
      load,
      loading,
      notice,
      reset,
      save,
      saving,
      scope,
      updateDraft,
    ],
  )
}

export function diffSettingsForProjectOverrides(base: unknown, value: unknown): unknown {
  if (settingsValuesEqual(base, value)) return undefined
  if (Array.isArray(value)) return value
  if (!isPlainObject(base) || !isPlainObject(value)) {
    return value
  }

  const diff: Record<string, unknown> = {}
  for (const [key, nextValue] of Object.entries(value)) {
    const childDiff = diffSettingsForProjectOverrides(base[key], nextValue)
    if (childDiff !== undefined) diff[key] = childDiff
  }

  return Object.keys(diff).length > 0 ? diff : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((item, index) => settingsValuesEqual(item, right[index]))
  }

  if (!isPlainObject(left) || !isPlainObject(right)) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && settingsValuesEqual(left[key], right[key]),
  )
}
