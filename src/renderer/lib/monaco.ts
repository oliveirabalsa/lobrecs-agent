import type { Monaco } from '@monaco-editor/react'

/**
 * Shared Monaco helpers — theme registration + language detection.
 *
 * Both `<Editor>` and `<DiffEditor>` only know a theme *name*; the theme
 * itself must be registered with `monaco.editor.defineTheme()` before mount.
 * Pass `registerDraculaTheme` to the `beforeMount` prop and set
 * `theme={DRACULA_THEME_NAME}`.
 */

export const DRACULA_THEME_NAME = 'dracula'

/** The canonical Dracula palette (https://draculatheme.com). */
const dracula = {
  background: '#282a36',
  currentLine: '#44475a',
  selection: '#44475a',
  foreground: '#f8f8f2',
  comment: '#6272a4',
  cyan: '#8be9fd',
  green: '#50fa7b',
  orange: '#ffb86c',
  pink: '#ff79c6',
  purple: '#bd93f9',
  red: '#ff5555',
  yellow: '#f1fa8c',
} as const

/** Strip the leading `#` — Monaco's `rules[].foreground` wants bare hex. */
const hex = (color: string): string => color.replace('#', '')

let themeRegistered = false

/**
 * Register the Dracula theme on the shared Monaco instance. Idempotent: the
 * module-level guard skips redundant `defineTheme` calls when many editors
 * mount in one session.
 */
export function registerDraculaTheme(monaco: Monaco): void {
  if (themeRegistered) return
  themeRegistered = true

  monaco.editor.defineTheme(DRACULA_THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: hex(dracula.foreground) },
      { token: 'comment', foreground: hex(dracula.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(dracula.pink) },
      { token: 'operator', foreground: hex(dracula.pink) },
      { token: 'string', foreground: hex(dracula.yellow) },
      { token: 'string.escape', foreground: hex(dracula.pink) },
      { token: 'regexp', foreground: hex(dracula.red) },
      { token: 'number', foreground: hex(dracula.purple) },
      { token: 'type', foreground: hex(dracula.cyan) },
      { token: 'type.identifier', foreground: hex(dracula.cyan) },
      { token: 'identifier', foreground: hex(dracula.foreground) },
      { token: 'delimiter', foreground: hex(dracula.foreground) },
      { token: 'tag', foreground: hex(dracula.pink) },
      { token: 'metatag', foreground: hex(dracula.pink) },
      { token: 'attribute.name', foreground: hex(dracula.green) },
      { token: 'attribute.value', foreground: hex(dracula.yellow) },
      { token: 'annotation', foreground: hex(dracula.green) },
    ],
    colors: {
      'editor.background': dracula.background,
      'editor.foreground': dracula.foreground,
      'editorLineNumber.foreground': dracula.comment,
      'editorLineNumber.activeForeground': dracula.foreground,
      'editor.lineHighlightBackground': dracula.currentLine,
      'editor.selectionBackground': dracula.selection,
      'editorCursor.foreground': dracula.foreground,
      'editorWhitespace.foreground': '#3b3d54',
      'editorIndentGuide.background': '#3b3d54',
      'editorGutter.background': dracula.background,
      // Diff gutters tinted with Dracula green / red at low alpha.
      'diffEditor.insertedTextBackground': '#50fa7b22',
      'diffEditor.removedTextBackground': '#ff555522',
      'diffEditor.insertedLineBackground': '#50fa7b14',
      'diffEditor.removedLineBackground': '#ff555514',
    },
  })
}

/** Map a file path to a Monaco language id (best-effort, by extension). */
export function languageFromPath(filePath: string): string {
  const extension = filePath.split('.').at(-1)?.toLowerCase()

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    default:
      return 'plaintext'
  }
}
