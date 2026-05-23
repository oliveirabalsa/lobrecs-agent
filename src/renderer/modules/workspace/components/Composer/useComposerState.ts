import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SUPPORTED_AGENT_IDS } from '../../../../../shared/types'
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue'
import {
  FALLBACK_MODEL_CATALOGS,
  catalogOptions,
  groupModelOptions,
} from './modelCatalog'
import { PLAN_MODE_RESET_EVENT } from './planMode'
import type {
  AgentModelCatalog,
  ApprovalMode,
  AttachedImage,
  ModelGroup,
  ModelOption,
  ModelSelection,
  SupportedAgentId,
  RoutingDecision,
  ThinkingLevel,
} from './types'

const APPROVAL_MODE_KEY = 'composer.approvalMode'
const MODEL_SELECTION_KEY = 'composer.modelSelection'
const PLAN_MODE_KEY = 'composer.planMode'

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function readApprovalMode(): ApprovalMode {
  const ls = safeStorage()
  const value = ls?.getItem(APPROVAL_MODE_KEY)
  if (value === 'full' || value === 'auto-safe' || value === 'manual') return value
  return 'full'
}

function parseThinking(value: unknown): ThinkingLevel | undefined {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high') return value
  return undefined
}

function readModelSelection(): ModelSelection {
  const ls = safeStorage()
  const raw = ls?.getItem(MODEL_SELECTION_KEY)
  if (!raw) return { kind: 'auto' }
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string
      agentId?: string
      modelId?: string
      thinking?: unknown
    }
    const thinking = parseThinking(parsed.thinking)
    if (parsed.kind === 'auto') return thinking ? { kind: 'auto', thinking } : { kind: 'auto' }
    if (parsed.kind === 'manual' && parsed.agentId && parsed.modelId) {
      if (SUPPORTED_AGENT_IDS.includes(parsed.agentId as SupportedAgentId)) {
        return {
          kind: 'manual',
          agentId: parsed.agentId as SupportedAgentId,
          modelId: parsed.modelId,
          thinking,
        }
      }
    }
  } catch {
    // ignore malformed value
  }
  return { kind: 'auto' }
}

function writeApprovalMode(mode: ApprovalMode): void {
  const ls = safeStorage()
  if (!ls) return
  ls.setItem(APPROVAL_MODE_KEY, mode)
}

function readPlanMode(): boolean {
  return safeStorage()?.getItem(PLAN_MODE_KEY) === 'true'
}

function writePlanMode(value: boolean): void {
  const ls = safeStorage()
  if (!ls) return
  if (value) ls.setItem(PLAN_MODE_KEY, 'true')
  else ls.removeItem(PLAN_MODE_KEY)
}

function writeModelSelection(selection: ModelSelection): void {
  const ls = safeStorage()
  if (!ls) return
  if (selection.kind === 'auto' && !selection.thinking) {
    ls.removeItem(MODEL_SELECTION_KEY)
    return
  }
  ls.setItem(MODEL_SELECTION_KEY, JSON.stringify(selection))
}

export interface UseComposerStateOptions {
  projectId: string
  prefillPrompt?: string
}

export interface UseComposerStateResult {
  draft: string
  setDraft: (value: string) => void
  attachments: AttachedImage[]
  addAttachments: (next: AttachedImage[]) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void
  attaching: boolean
  setAttaching: (value: boolean) => void
  approvalMode: ApprovalMode
  setApprovalMode: (mode: ApprovalMode) => void
  /** When true, the next dispatch runs in plan mode (plan first, then approve). */
  planMode: boolean
  setPlanMode: (value: boolean) => void
  modelSelection: ModelSelection
  setModelSelection: (selection: ModelSelection) => void
  modelCatalogs: AgentModelCatalog[]
  modelGroups: ModelGroup[]
  manualOption: ModelOption | null
  routerPreview: RoutingDecision | null
  error: string | null
  setError: (value: string | null) => void
}

/**
 * Centralizes composer state: draft, image attachments, model selection,
 * approval mode, and the debounced router-preview round-trip.
 *
 * Persists model selection + approval mode to `localStorage` under the
 * `composer.*` namespace. Draft is intentionally session-local.
 */
export function useComposerState({
  projectId,
  prefillPrompt,
}: UseComposerStateOptions): UseComposerStateResult {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachmentsState] = useState<AttachedImage[]>([])
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approvalMode, setApprovalModeState] = useState<ApprovalMode>(() => readApprovalMode())
  const [planMode, setPlanModeState] = useState<boolean>(() => readPlanMode())
  const [modelSelection, setModelSelectionState] = useState<ModelSelection>(() =>
    readModelSelection(),
  )
  const [modelCatalogs, setModelCatalogs] = useState<AgentModelCatalog[]>(FALLBACK_MODEL_CATALOGS)
  const [routerPreview, setRouterPreview] = useState<RoutingDecision | null>(null)

  const attachmentsRef = useRef<AttachedImage[]>([])
  const debouncedDraft = useDebouncedValue(draft, 500)

  // Pull live model catalogs from main on mount.
  useEffect(() => {
    let cancelled = false
    window.agentforge.system
      .listAgentModels()
      .then((catalogs) => {
        if (!cancelled && catalogs.some((catalog) => catalog.models.length > 0)) {
          setModelCatalogs(catalogs)
        }
      })
      .catch(() => {
        if (!cancelled) setModelCatalogs(FALLBACK_MODEL_CATALOGS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  // Revoke any outstanding preview URLs on unmount to prevent leaks.
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    }
  }, [])

  useEffect(() => {
    if (prefillPrompt === undefined) return
    setDraft(prefillPrompt)
  }, [prefillPrompt])

  // Router preview — only when auto selection and draft non-empty.
  useEffect(() => {
    if (modelSelection.kind !== 'auto' || !debouncedDraft.trim()) {
      setRouterPreview(null)
      return
    }
    let cancelled = false
    window.agentforge.router
      .preview(debouncedDraft, projectId)
      .then((decision) => {
        if (!cancelled) setRouterPreview(decision)
      })
      .catch(() => {
        if (!cancelled) setRouterPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedDraft, modelSelection, projectId])

  const modelGroups = useMemo(() => groupModelOptions(modelCatalogs), [modelCatalogs])

  const manualOption = useMemo<ModelOption | null>(() => {
    if (modelSelection.kind !== 'manual') return null
    const allOptions = catalogOptions(modelCatalogs)
    const fromLive = allOptions.find(
      (option) =>
        option.agentId === modelSelection.agentId && option.modelId === modelSelection.modelId,
    )
    if (fromLive) return fromLive
    const fromFallback = catalogOptions(FALLBACK_MODEL_CATALOGS).find(
      (option) =>
        option.agentId === modelSelection.agentId && option.modelId === modelSelection.modelId,
    )
    return fromFallback ?? null
  }, [modelCatalogs, modelSelection])

  useEffect(() => {
    if (modelSelection.kind !== 'manual' || manualOption) return
    setModelSelectionState({ kind: 'auto' })
    writeModelSelection({ kind: 'auto' })
  }, [manualOption, modelSelection])

  const setApprovalMode = useCallback((mode: ApprovalMode) => {
    setApprovalModeState(mode)
    writeApprovalMode(mode)
  }, [])

  const setPlanMode = useCallback((value: boolean) => {
    setPlanModeState(value)
    writePlanMode(value)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePlanModeReset = () => {
      setPlanMode(false)
    }

    window.addEventListener(PLAN_MODE_RESET_EVENT, handlePlanModeReset)
    return () => window.removeEventListener(PLAN_MODE_RESET_EVENT, handlePlanModeReset)
  }, [setPlanMode])

  const setModelSelection = useCallback((selection: ModelSelection) => {
    setModelSelectionState(selection)
    writeModelSelection(selection)
  }, [])

  const addAttachments = useCallback((next: AttachedImage[]) => {
    setAttachmentsState((current) => [...current, ...next].slice(0, 8))
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachmentsState((current) => {
      const removed = current.find((image) => image.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((image) => image.id !== id)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachmentsState((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl))
      return []
    })
  }, [])

  return {
    draft,
    setDraft,
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    attaching,
    setAttaching,
    approvalMode,
    setApprovalMode,
    planMode,
    setPlanMode,
    modelSelection,
    setModelSelection,
    modelCatalogs,
    modelGroups,
    manualOption,
    routerPreview,
    error,
    setError,
  }
}
