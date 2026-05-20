import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/*
 * Runtime theme system. Both themes are dark; switching only swaps the values
 * of the CSS custom properties defined in main.css under :root[data-theme], so
 * no component className changes. The active theme is mirrored onto
 * <html data-theme> and persisted to localStorage as a per-device visual
 * preference — deliberately NOT part of the disk-backed AppSettings contract,
 * which would force coordinated edits across four files and a load-time race.
 */

export const THEME_IDS = ['midnight', 'lobrecs-wolf'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME: ThemeId = 'midnight'

/** Shared by this provider and the no-flash bootstrap script in index.html. */
export const THEME_STORAGE_KEY = 'lobrecs.theme'

/**
 * Presentation metadata for the settings theme picker. The swatch hexes are
 * literal on purpose: a preview must show a theme's palette regardless of
 * which theme is currently active, so they cannot be design tokens. This is
 * the one place theme color literals are allowed to live outside main.css.
 */
export const THEME_META: Record<
  ThemeId,
  { label: string; description: string; swatches: [string, string, string, string] }
> = {
  midnight: {
    label: 'Midnight',
    description: 'The original cool-grey dark theme with a soft top glow.',
    swatches: ['#0e0e0f', '#1c1c20', '#3b82f6', '#f4f4f5'],
  },
  'lobrecs-wolf': {
    label: 'Lobrecs Wolf',
    description: 'Near-black surfaces with a dark-red wolf glow and red accents.',
    swatches: ['#0c0708', '#1e1316', '#e0463c', '#fafafa'],
  },
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

/**
 * Resolves the theme for the very first React render. The no-flash bootstrap
 * in index.html may have already applied data-theme to <html> before mount, so
 * that attribute is preferred; localStorage is the fallback when the bootstrap
 * has not run, and DEFAULT_THEME is the final fallback.
 */
function resolveInitialTheme(): ThemeId {
  const fromDom = document.documentElement.dataset.theme
  if (isThemeId(fromDom)) {
    return fromDom
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeId(stored)) {
      return stored
    }
  } catch {
    // localStorage may be unavailable — fall through to the default.
  }
  return DEFAULT_THEME
}

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(resolveInitialTheme)

  // Reflect the active theme onto <html> (drives the CSS cascade) and persist
  // it. Runs on mount too, which is what restores a saved theme after reload.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Visual preference only — ignore storage failures (e.g. private mode).
    }
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
