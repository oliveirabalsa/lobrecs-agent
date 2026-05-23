import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/*
 * Runtime theme system. Themes are dark; switching only swaps the values of
 * the CSS custom properties defined in main.css under :root[data-theme], so
 * no component className changes. The active theme is mirrored onto
 * <html data-theme> and persisted to localStorage as a per-device visual
 * preference — deliberately NOT part of the disk-backed AppSettings contract,
 * which would force coordinated edits across four files and a load-time race.
 */

export const THEME_IDS = [
  'midnight',
  'blue-hour',
  'night-owl',
  'palenight',
  'tokyo-night',
  'cobalt-deep',
  'winter-is-coming',
  'deep-sea',
  'oceanic-noir',
  'black-ice',
  'nord-aurora',
  'one-dark',
  'dracula',
  'black-violet',
  'obsidian',
  'blackout',
  'ink-black',
  'carbon-black',
  'ash-black',
  'soft-black',
] as const
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
  'blue-hour': {
    label: 'Blue Hour',
    description: 'Deep blue-black dusk surfaces with cobalt gradients and a crisp electric accent.',
    swatches: ['#050914', '#101827', '#60a5fa', '#eff6ff'],
  },
  'night-owl': {
    label: 'Night Owl',
    description: 'Inky midnight blue surfaces with a cool teal-blue accent, inspired by Night Owl.',
    swatches: ['#011627', '#0b2a3a', '#7fdbca', '#d6deeb'],
  },
  palenight: {
    label: 'Palenight',
    description: 'Soft indigo-grey base with periwinkle accents and a calm material feel.',
    swatches: ['#1e1f2e', '#292d3e', '#82aaff', '#eeffff'],
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    description: 'Deep navy surfaces with indigo gradients and a glowing blue accent.',
    swatches: ['#1a1b26', '#24283b', '#7aa2f7', '#c0caf5'],
  },
  'cobalt-deep': {
    label: 'Cobalt Deep',
    description: 'Rich cobalt-black surfaces with a vivid blue accent and electric highlights.',
    swatches: ['#031429', '#0a2240', '#0088ff', '#e6f2ff'],
  },
  'winter-is-coming': {
    label: 'Winter Is Coming',
    description: 'Frosted dark-blue surfaces with ice-blue accents and a crisp wintery glow.',
    swatches: ['#001629', '#062338', '#5ccfe6', '#d4f1ff'],
  },
  'deep-sea': {
    label: 'Deep Sea',
    description: 'Abyssal navy black with cyan glow and submerged blue gradients.',
    swatches: ['#020a18', '#071527', '#22d3ee', '#e0f7ff'],
  },
  'oceanic-noir': {
    label: 'Oceanic Noir',
    description: 'Deep ocean black with petrol-blue panels, cyan glow, and submerged gradients.',
    swatches: ['#031014', '#0b1f26', '#22d3ee', '#ecfeff'],
  },
  'black-ice': {
    label: 'Black Ice',
    description: 'Hard black surfaces with blue-white glass edges and a cold cyan glow.',
    swatches: ['#020407', '#101820', '#38bdf8', '#f8fbff'],
  },
  'nord-aurora': {
    label: 'Nord Aurora',
    description: 'Polar night surfaces with a frosted steel-blue accent inspired by Nord.',
    swatches: ['#0d1117', '#1c2330', '#88c0d0', '#eceff4'],
  },
  'one-dark': {
    label: 'One Dark',
    description: 'Atom-style charcoal surfaces with a soft slate-blue accent.',
    swatches: ['#1a1c22', '#282c34', '#61afef', '#e6e6e6'],
  },
  dracula: {
    label: 'Dracula',
    description: 'Classic Dracula-inspired ink black with a soft purple accent and gentle bloom.',
    swatches: ['#1a1b26', '#282a36', '#bd93f9', '#f8f8f2'],
  },
  'black-violet': {
    label: 'Black Violet',
    description: 'Ink-black workspace with violet bloom, magenta highlights, and sharp contrast.',
    swatches: ['#050208', '#16101f', '#a855f7', '#faf5ff'],
  },
  obsidian: {
    label: 'Obsidian',
    description: 'Cold obsidian black with neutral grey-white accents and minimal chromatic noise.',
    swatches: ['#0b0d10', '#15181d', '#dcdfe4', '#f5f7fa'],
  },
  blackout: {
    label: 'Blackout',
    description: 'Pure black shell with only hard grey layers and crisp white contrast.',
    swatches: ['#000000', '#050505', '#737373', '#f5f5f5'],
  },
  'ink-black': {
    label: 'Ink Black',
    description: 'Liquid black surfaces with charcoal depth and soft grey highlights.',
    swatches: ['#030303', '#0a0a0a', '#8a8a8a', '#f2f2f2'],
  },
  'carbon-black': {
    label: 'Carbon Black',
    description: 'Layered carbon grey panels over black with satin monochrome gradients.',
    swatches: ['#050505', '#111111', '#737373', '#ededed'],
  },
  'ash-black': {
    label: 'Ash Black',
    description: 'Smoky black with warm dark-grey surfaces and muted ash highlights.',
    swatches: ['#070707', '#181818', '#9ca3af', '#f3f4f6'],
  },
  'soft-black': {
    label: 'Soft Black',
    description: 'Lighter black and dark grey surfaces with a calmer low-contrast feel.',
    swatches: ['#0a0a0a', '#171717', '#a3a3a3', '#f5f5f5'],
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
