import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { RightPanelMode } from '../components/WorkspaceTopBar'

const RIGHT_PANEL_WIDTH_KEY = 'lobrecs.right-panel-width'

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function rightPanelOpenKey(threadId: string | null): string {
  return threadId ? `workspace.rightPanelOpen.${threadId}` : 'workspace.rightPanelOpen'
}

function rightPanelModeKey(threadId: string | null): string {
  return threadId ? `workspace.rightPanelMode.${threadId}` : 'workspace.rightPanelMode'
}

function readPanelOpen(threadId: string | null, fallback = false): boolean {
  const ls = safeStorage()
  if (!ls) return fallback
  const key = rightPanelOpenKey(threadId)
  if (ls.getItem(key) === null) return fallback
  return ls.getItem(key) === '1'
}

function readPanelMode(threadId: string | null, fallback: RightPanelMode = 'diff'): RightPanelMode {
  const value = safeStorage()?.getItem(rightPanelModeKey(threadId))
  if (value === null || value === undefined) return fallback
  if (
    value === 'terminal' ||
    value === 'swarm' ||
    value === 'context' ||
    value === 'reviews' ||
    value === 'doctor' ||
    value === 'evidence'
  ) {
    return value
  }
  return 'diff'
}

function readPanelWidth(): number {
  const saved = safeStorage()?.getItem(RIGHT_PANEL_WIDTH_KEY)
  if (saved) {
    const val = parseInt(saved, 10)
    if (!isNaN(val)) return val
  }
  return typeof window !== 'undefined' && window.innerWidth >= 1536 ? 520 : 420
}

export interface UseWorkspaceRightPanelStateInput {
  activeThreadId: string | null
  defaultOpen?: boolean
  defaultMode?: RightPanelMode
  diffCount: number
}

export function useWorkspaceRightPanelState({
  activeThreadId,
  defaultOpen = false,
  defaultMode = 'diff',
  diffCount,
}: UseWorkspaceRightPanelStateInput) {
  const activeThreadIdRef = useRef(activeThreadId)
  activeThreadIdRef.current = activeThreadId

  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(() =>
    readPanelOpen(activeThreadId, defaultOpen),
  )
  const [rightPanelMounted, setRightPanelMounted] = useState<boolean>(() =>
    readPanelOpen(activeThreadId, defaultOpen),
  )
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(() =>
    readPanelMode(activeThreadId, defaultMode),
  )
  const [rightPanelFullscreen, setRightPanelFullscreen] = useState(false)
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => readPanelWidth())

  const startRightPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = rightPanelWidth

      function handlePointerMove(moveEvent: PointerEvent) {
        const delta = moveEvent.clientX - startX
        const newWidth = Math.max(320, Math.min(800, startWidth - delta))
        setRightPanelWidth(newWidth)
        safeStorage()?.setItem(RIGHT_PANEL_WIDTH_KEY, String(newWidth))
      }

      function handlePointerUp() {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [rightPanelWidth],
  )

  useEffect(() => {
    if (rightPanelOpen) setRightPanelMounted(true)
  }, [rightPanelOpen])

  useEffect(() => {
    const open = readPanelOpen(activeThreadId, defaultOpen)
    setRightPanelOpen(open)
    setRightPanelMounted(open)
    setRightPanelMode(readPanelMode(activeThreadId, defaultMode))
  }, [activeThreadId, defaultMode, defaultOpen])

  useEffect(() => {
    const ls = safeStorage()
    if (ls?.getItem(rightPanelOpenKey(activeThreadIdRef.current)) !== null) return
    setRightPanelOpen(defaultOpen)
    setRightPanelMounted(defaultOpen)
  }, [defaultOpen])

  useEffect(() => {
    const ls = safeStorage()
    if (ls?.getItem(rightPanelModeKey(activeThreadIdRef.current)) !== null) return
    setRightPanelMode(defaultMode)
  }, [defaultMode])

  useEffect(() => {
    const ls = safeStorage()
    if (!ls) return
    const key = rightPanelOpenKey(activeThreadIdRef.current)
    if (rightPanelOpen) ls.setItem(key, '1')
    else ls.setItem(key, '0')
  }, [rightPanelOpen])

  useEffect(() => {
    safeStorage()?.setItem(rightPanelModeKey(activeThreadIdRef.current), rightPanelMode)
  }, [rightPanelMode])

  useEffect(() => {
    if (rightPanelMode === 'diff' && diffCount === 0 && rightPanelOpen) {
      setRightPanelMode('terminal')
    }
  }, [diffCount, rightPanelMode, rightPanelOpen])

  useEffect(() => {
    if (rightPanelMode === 'swarm' && !activeThreadId && rightPanelOpen) {
      setRightPanelMode('terminal')
    }
  }, [activeThreadId, rightPanelMode, rightPanelOpen])

  useEffect(() => {
    if (rightPanelMode === 'swarm' && rightPanelOpen) {
      setRightPanelFullscreen(true)
    }
  }, [rightPanelMode, rightPanelOpen])

  const toggleRightPanel = useCallback(
    (mode: RightPanelMode) => {
      setRightPanelOpen((prev) => {
        if (prev && rightPanelMode === mode) return false
        return true
      })
      setRightPanelMode(mode)
    },
    [rightPanelMode],
  )

  const openMode = useCallback((mode: RightPanelMode, fullscreen = false) => {
    setRightPanelOpen(true)
    setRightPanelMode(mode)
    if (fullscreen) setRightPanelFullscreen(true)
  }, [])

  const closeRightPanel = useCallback(() => {
    setRightPanelFullscreen(false)
    setRightPanelOpen(false)
  }, [])

  return {
    rightPanelOpen,
    rightPanelMounted,
    rightPanelMode,
    rightPanelFullscreen,
    rightPanelWidth,
    setRightPanelOpen,
    setRightPanelMounted,
    setRightPanelMode,
    setRightPanelFullscreen,
    startRightPanelResize,
    toggleRightPanel,
    openMode,
    closeRightPanel,
  }
}
