import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export type EditorKind = 'gui' | 'cli'

export interface EditorInfo {
  id: string
  name: string
  kind: EditorKind
  /** macOS .app bundle name (without .app) for GUI, or CLI binary name. */
  target: string
  /** Discovered executable path used to confirm the editor is installed. */
  binPath?: string
}

interface GuiCandidate {
  id: string
  name: string
  appName: string
}

interface CliCandidate {
  id: string
  name: string
  command: string
}

const GUI_CANDIDATES: readonly GuiCandidate[] = [
  { id: 'vscode', name: 'Visual Studio Code', appName: 'Visual Studio Code' },
  { id: 'cursor', name: 'Cursor', appName: 'Cursor' },
  { id: 'zed', name: 'Zed', appName: 'Zed' },
  { id: 'sublime', name: 'Sublime Text', appName: 'Sublime Text' },
  { id: 'nova', name: 'Nova', appName: 'Nova' },
  { id: 'xcode', name: 'Xcode', appName: 'Xcode' },
  { id: 'intellij', name: 'IntelliJ IDEA', appName: 'IntelliJ IDEA' },
  { id: 'intellij-ce', name: 'IntelliJ IDEA CE', appName: 'IntelliJ IDEA CE' },
  { id: 'webstorm', name: 'WebStorm', appName: 'WebStorm' },
  { id: 'pycharm', name: 'PyCharm', appName: 'PyCharm' },
  { id: 'pycharm-ce', name: 'PyCharm CE', appName: 'PyCharm CE' },
  { id: 'goland', name: 'GoLand', appName: 'GoLand' },
  { id: 'rustrover', name: 'RustRover', appName: 'RustRover' },
  { id: 'phpstorm', name: 'PhpStorm', appName: 'PhpStorm' },
  { id: 'rubymine', name: 'RubyMine', appName: 'RubyMine' },
  { id: 'clion', name: 'CLion', appName: 'CLion' },
  { id: 'rider', name: 'Rider', appName: 'Rider' },
  { id: 'datagrip', name: 'DataGrip', appName: 'DataGrip' },
  { id: 'android-studio', name: 'Android Studio', appName: 'Android Studio' },
]

const CLI_CANDIDATES: readonly CliCandidate[] = [
  { id: 'vim', name: 'Vim', command: 'vim' },
  { id: 'nvim', name: 'Neovim', command: 'nvim' },
  { id: 'helix', name: 'Helix', command: 'hx' },
]

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findAppBundle(appName: string): Promise<boolean> {
  const candidates = [
    path.join('/Applications', `${appName}.app`),
    path.join(homedir(), 'Applications', `${appName}.app`),
    path.join('/Applications/JetBrains Toolbox', `${appName}.app`),
  ]
  const results = await Promise.all(candidates.map(pathExists))
  return results.some(Boolean)
}

async function findCliBinary(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [command], {
      timeout: 1500,
    })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

let cached: EditorInfo[] | null = null

/**
 * macOS-only. Detects installed GUI editors by probing /Applications +
 * ~/Applications, and CLI editors via `which`. Results are cached for the
 * lifetime of the main process — call invalidateEditorCache() to refresh.
 */
export async function detectEditors(): Promise<EditorInfo[]> {
  if (cached) return cached
  if (process.platform !== 'darwin') {
    cached = []
    return cached
  }

  const guiPromises = GUI_CANDIDATES.map(async (candidate): Promise<EditorInfo | null> => {
    const installed = await findAppBundle(candidate.appName)
    if (!installed) return null
    return {
      id: candidate.id,
      name: candidate.name,
      kind: 'gui',
      target: candidate.appName,
    }
  })

  const cliPromises = CLI_CANDIDATES.map(async (candidate): Promise<EditorInfo | null> => {
    const binPath = await findCliBinary(candidate.command)
    if (!binPath) return null
    return {
      id: candidate.id,
      name: candidate.name,
      kind: 'cli',
      target: candidate.command,
      binPath,
    }
  })

  const results = await Promise.all([...guiPromises, ...cliPromises])
  cached = results.filter((entry): entry is EditorInfo => entry !== null)
  return cached
}

export function invalidateEditorCache(): void {
  cached = null
}
