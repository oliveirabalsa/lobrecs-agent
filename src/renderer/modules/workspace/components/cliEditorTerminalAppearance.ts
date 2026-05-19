export const CLI_EDITOR_TERMINAL_THEME = {
  background: '#09090b',
  foreground: '#f4f4f5',
  cursor: '#fbbf24',
  cursorAccent: '#09090b',
  black: '#18181b',
  blue: '#60a5fa',
  cyan: '#22d3ee',
  green: '#34d399',
  red: '#f87171',
  yellow: '#fbbf24',
  magenta: '#c084fc',
  white: '#f4f4f5',
} as const

export const CLI_EDITOR_TERMINAL_FONT =
  'JetBrainsMono Nerd Font, JetBrains Mono NF, JetBrains Mono, MesloLGS NF, Hack Nerd Font, FiraCode Nerd Font, Menlo, Monaco, Consolas, monospace'

export const CLI_EDITOR_TERMINAL_OPTIONS = {
  theme: CLI_EDITOR_TERMINAL_THEME,
  fontFamily: CLI_EDITOR_TERMINAL_FONT,
  fontSize: 13,
  lineHeight: 1.35,
  cursorBlink: true,
  cursorStyle: 'block',
  cursorInactiveStyle: 'block',
  convertEol: true,
  scrollback: 8000,
} as const
