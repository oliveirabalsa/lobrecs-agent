import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type { ModelTier, SessionStatus } from '../../../../shared/types'

export interface Tab {
  sessionId: string
  projectId: string
  prompt: string
  status: SessionStatus
  model: string
  tier: ModelTier | string
  createdAt: number
}

export type TabsState = {
  tabs: Tab[]
  activeTabId: string | null
}

export type TabsAction =
  | { type: 'ADD_TAB'; tab: Tab }
  | { type: 'SET_ACTIVE'; sessionId: string }
  | { type: 'UPDATE_STATUS'; sessionId: string; status: Tab['status'] }
  | { type: 'CLOSE_TAB'; sessionId: string }
  | { type: 'RESET'; state?: TabsState }

export const initialTabsState: TabsState = {
  tabs: [],
  activeTabId: null,
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'ADD_TAB': {
      const existing = state.tabs.find((tab) => tab.sessionId === action.tab.sessionId)
      if (existing) {
        return {
          tabs: state.tabs.map((tab) =>
            tab.sessionId === action.tab.sessionId ? { ...tab, ...action.tab } : tab,
          ),
          activeTabId: action.tab.sessionId,
        }
      }

      return {
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.sessionId,
      }
    }

    case 'SET_ACTIVE': {
      if (!state.tabs.some((tab) => tab.sessionId === action.sessionId)) return state
      return { ...state, activeTabId: action.sessionId }
    }

    case 'UPDATE_STATUS':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.sessionId === action.sessionId ? { ...tab, status: action.status } : tab,
        ),
      }

    case 'CLOSE_TAB': {
      const remaining = state.tabs.filter((tab) => tab.sessionId !== action.sessionId)
      const activeStillExists = remaining.some((tab) => tab.sessionId === state.activeTabId)

      return {
        tabs: remaining,
        activeTabId: activeStillExists
          ? state.activeTabId
          : remaining.length > 0
            ? remaining[remaining.length - 1].sessionId
            : null,
      }
    }

    case 'RESET':
      return action.state ?? initialTabsState
  }
}

interface TabsContextValue extends TabsState {
  activeTab: Tab | null
  addTab: (tab: Tab) => void
  setActive: (sessionId: string) => void
  updateStatus: (sessionId: string, status: Tab['status']) => void
  closeTab: (sessionId: string) => void
  resetTabs: (state?: TabsState) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

interface TabsProviderProps {
  children: ReactNode
  initialState?: TabsState
}

export function TabsProvider({ children, initialState = initialTabsState }: TabsProviderProps) {
  const [state, dispatch] = useReducer(tabsReducer, initialState)

  const addTab = useCallback((tab: Tab) => dispatch({ type: 'ADD_TAB', tab }), [])
  const setActive = useCallback(
    (sessionId: string) => dispatch({ type: 'SET_ACTIVE', sessionId }),
    [],
  )
  const updateStatus = useCallback(
    (sessionId: string, status: Tab['status']) =>
      dispatch({ type: 'UPDATE_STATUS', sessionId, status }),
    [],
  )
  const closeTab = useCallback(
    (sessionId: string) => dispatch({ type: 'CLOSE_TAB', sessionId }),
    [],
  )
  const resetTabs = useCallback((nextState?: TabsState) => {
    dispatch({ type: 'RESET', state: nextState })
  }, [])

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.sessionId === state.activeTabId) ?? null,
    [state.activeTabId, state.tabs],
  )

  const value = useMemo(
    () => ({
      ...state,
      activeTab,
      addTab,
      setActive,
      updateStatus,
      closeTab,
      resetTabs,
    }),
    [activeTab, addTab, closeTab, resetTabs, setActive, state, updateStatus],
  )

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
}

export function useTabs(): TabsContextValue {
  const context = useContext(TabsContext)
  if (!context) throw new Error('useTabs must be used within TabsProvider')
  return context
}
