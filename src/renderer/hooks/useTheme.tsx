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
  'lobrecs-wolf',
  'aurora-nebula',
  'solar-forge',
  'black-ice',
  'black-ember',
  'black-violet',
  'black-forest',
  'blackout',
  'ink-black',
  'soft-black',
  'carbon-black',
  'ash-black',
  'blue-hour',
  'cyber-mint',
  'crimson-depth',
  'graphite-rose',
  'oceanic-noir',
  'toxic-terminal',
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
  'lobrecs-wolf': {
    label: 'Lobrecs Wolf',
    description: 'Near-black surfaces with a dark-red wolf glow and red accents.',
    swatches: ['#0c0708', '#1e1316', '#e0463c', '#fafafa'],
  },
  'aurora-nebula': {
    label: 'Aurora Nebula',
    description: 'Vibrant neon purple and green theme with deep indigo surfaces and emerald accents.',
    swatches: ['#090610', '#150f24', '#10b981', '#f5f0ff'],
  },
  'solar-forge': {
    label: 'Solar Forge',
    description: 'Warm dark charcoal surfaces with an amber copper glow and orange-gold accents.',
    swatches: ['#0d0a06', '#1d1710', '#f59e0b', '#fff8eb'],
  },
  'black-ice': {
    label: 'Black Ice',
    description: 'Hard black surfaces with blue-white glass edges and a cold cyan glow.',
    swatches: ['#020407', '#101820', '#38bdf8', '#f8fbff'],
  },
  'black-ember': {
    label: 'Black Ember',
    description: 'Matte black with coal-red depth, ember orange accents, and smoky gradients.',
    swatches: ['#030202', '#17100d', '#fb923c', '#fff4ed'],
  },
  'black-violet': {
    label: 'Black Violet',
    description: 'Ink-black workspace with violet bloom, magenta highlights, and sharp contrast.',
    swatches: ['#050208', '#16101f', '#a855f7', '#faf5ff'],
  },
  'black-forest': {
    label: 'Black Forest',
    description: 'Almost-black green with moss accents, soft emerald glow, and grounded contrast.',
    swatches: ['#020503', '#0f1a12', '#22c55e', '#f0fff4'],
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
  'soft-black': {
    label: 'Soft Black',
    description: 'Lighter black and dark grey surfaces with a calmer low-contrast feel.',
    swatches: ['#0a0a0a', '#171717', '#a3a3a3', '#f5f5f5'],
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
  'blue-hour': {
    label: 'Blue Hour',
    description: 'Deep blue-black dusk surfaces with cobalt gradients and a crisp electric accent.',
    swatches: ['#050914', '#101827', '#60a5fa', '#eff6ff'],
  },
  'cyber-mint': {
    label: 'Cyber Mint',
    description: 'Dark graphite with teal-mint gradients, neon controls, and clean glassy panels.',
    swatches: ['#06100e', '#111d1a', '#2dd4bf', '#ecfeff'],
  },
  'crimson-depth': {
    label: 'Crimson Depth',
    description: 'Dark wine surfaces with layered ruby gradients and bright red action accents.',
    swatches: ['#100407', '#211016', '#ef4444', '#fff1f2'],
  },
  'graphite-rose': {
    label: 'Graphite Rose',
    description: 'Neutral graphite base with rose-pink gradients and restrained warm highlights.',
    swatches: ['#09090b', '#1b161a', '#f472b6', '#fff7fb'],
  },
  'oceanic-noir': {
    label: 'Oceanic Noir',
    description: 'Deep ocean black with petrol-blue panels, cyan glow, and submerged gradients.',
    swatches: ['#031014', '#0b1f26', '#22d3ee', '#ecfeff'],
  },
  'toxic-terminal': {
    label: 'Toxic Terminal',
    description: 'Dark terminal green with acid-lime accents and a subtle radioactive glow.',
    swatches: ['#050805', '#101a0c', '#a3e635', '#f7fee7'],
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
