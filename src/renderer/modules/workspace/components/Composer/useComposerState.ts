import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue'
import type {
  AgentModelCatalog,
  ApprovalMode,
  AttachedImage,
  ModelGroup,
  ModelOption,
  ModelSelection,
  RoutingDecision,
} from './types'

const APPROVAL_MODE_KEY = 'composer.approvalMode'
const MODEL_SELECTION_KEY = 'composer.modelSelection'

const FALLBACK_MODEL_CATALOGS: AgentModelCatalog[] = [
  {
    agentId: 'claude-code',
    name: 'Claude Code',
    installed: true,
    models: [
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'claude-haiku-4-5',
        agentId: 'claude-code',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'claude-sonnet-4-6',
        agentId: 'claude-code',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'claude-opus-4-7',
        label: 'claude-opus-4-7',
        agentId: 'claude-code',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'codex',
    name: 'OpenAI Codex',
    installed: true,
    models: [
      {
        id: 'gpt-5.3-codex-spark',
        label: 'gpt-5.3-codex-spark',
        agentId: 'codex',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'gpt-5.3-codex',
        label: 'gpt-5.3-codex',
        agentId: 'codex',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        agentId: 'codex',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'opencode',
    name: 'OpenCode',
    installed: true,
    models: [
      {
        id: 'opencode/minimax-m2.5-free',
        label: 'opencode/minimax-m2.5-free',
        agentId: 'opencode',
        tier: 'lightweight',
        source: 'fallback',
      },
    ],
  },
]

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
  return 'manual'
}

function readModelSelection(): ModelSelection {
  const ls = safeStorage()
  const raw = ls?.getItem(MODEL_SELECTION_KEY)
  if (!raw) return { kind: 'auto' }
  try {
    const parsed = JSON.parse(raw) as { kind?: string; agentId?: string; modelId?: string }
    if (parsed.kind === 'manual' && parsed.agentId && parsed.modelId) {
      if (
        parsed.agentId === 'claude-code' ||
        parsed.agentId === 'codex' ||
        parsed.agentId === 'opencode'
      ) {
        return { kind: 'manual', agentId: parsed.agentId, modelId: parsed.modelId }
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

function writeModelSelection(selection: ModelSelection): void {
  const ls = safeStorage()
  if (!ls) return
  if (selection.kind === 'auto') {
    ls.removeItem(MODEL_SELECTION_KEY)
    return
  }
  ls.setItem(MODEL_SELECTION_KEY, JSON.stringify(selection))
}

function catalogOptions(catalogs: AgentModelCatalog[]): ModelOption[] {
  return catalogs.flatMap((catalog) =>
    catalog.models.map((model) => ({
      key: `${catalog.agentId}:${model.id}`,
      agentId: catalog.agentId,
      agentName: catalog.name,
      modelId: model.id,
      label: model.label,
      tier: model.tier,
    })),
  )
}

function groupModelOptions(catalogs: AgentModelCatalog[]): ModelGroup[] {
  return catalogs
    .filter((catalog) => catalog.installed && catalog.models.length > 0)
    .map((catalog) => ({
      agentId: catalog.agentId,
      label: catalog.name,
      options: catalogOptions([catalog]),
    }))
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
