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
  /** macOS .app bundle name (without .app) or absolute path for GUI, or CLI binary name. */
  target: string
  /** Discovered executable path used to confirm the editor is installed. */
  binPath?: string
}

interface CliCandidate {
  id: string
  name: string
  command: string
}

const CLI_CANDIDATES: readonly CliCandidate[] = [
  { id: 'vim', name: 'Vim', command: 'vim' },
  { id: 'nvim', name: 'Neovim', command: 'nvim' },
  { id: 'helix', name: 'Helix', command: 'hx' },
]

const ID_MAPPINGS: { keyword: string; id: string }[] = [
  { keyword: 'visual studio code', id: 'vscode' },
  { keyword: 'vscode', id: 'vscode' },
  { keyword: 'vscodium', id: 'vscode' },
  { keyword: 'cursor', id: 'cursor' },
  { keyword: 'zed', id: 'zed' },
  { keyword: 'sublime text', id: 'sublime' },
  { keyword: 'sublime', id: 'sublime' },
  { keyword: 'nova', id: 'nova' },
  { keyword: 'xcode', id: 'xcode' },
  { keyword: 'intellij idea ce', id: 'intellij-ce' },
  { keyword: 'intellij idea', id: 'intellij' },
  { keyword: 'intellij', id: 'intellij' },
  { keyword: 'webstorm', id: 'webstorm' },
  { keyword: 'pycharm ce', id: 'pycharm-ce' },
  { keyword: 'pycharm', id: 'pycharm' },
  { keyword: 'goland', id: 'goland' },
  { keyword: 'rustrover', id: 'rustrover' },
  { keyword: 'phpstorm', id: 'phpstorm' },
  { keyword: 'rubymine', id: 'rubymine' },
  { keyword: 'clion', id: 'clion' },
  { keyword: 'rider', id: 'rider' },
  { keyword: 'datagrip', id: 'datagrip' },
  { keyword: 'android studio', id: 'android-studio' },
  { keyword: 'antigravity', id: 'antigravity' },
  { keyword: 'opencode', id: 'opencode' },
  { keyword: 'codex', id: 'codex' },
]

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findCliBinary(command: string): Promise<string | null> {
  try {
    const result = await execFileAsync('/usr/bin/which', [command], {
      timeout: 1500,
    })
    const trimmed = result.stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function findAppsViaSpotlight(): Promise<string[]> {
  try {
    const query = `kMDItemContentType == 'com.apple.application-bundle' && (kMDItemAppStoreCategoryType == 'public.app-category.developer-tools' || kMDItemCFBundleIdentifier == '*code*' || kMDItemCFBundleIdentifier == '*editor*' || kMDItemCFBundleIdentifier == '*ide*' || kMDItemDisplayName == '*Sublime*' || kMDItemDisplayName == '*Zed*' || kMDItemDisplayName == '*Nova*' || kMDItemDisplayName == '*Cursor*' || kMDItemDisplayName == '*Antigravity*' || kMDItemDisplayName == '*OpenCode*' || kMDItemDisplayName == '*Visual Studio Code*' || kMDItemDisplayName == '*WebStorm*' || kMDItemDisplayName == '*PyCharm*' || kMDItemDisplayName == '*GoLand*' || kMDItemDisplayName == '*CLion*' || kMDItemDisplayName == '*Rider*' || kMDItemDisplayName == '*IntelliJ*' || kMDItemDisplayName == '*Codex*')`
    const result = await execFileAsync('/usr/bin/mdfind', [query], {
      timeout: 3000,
    })
    return result.stdout
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
  } catch (error) {
    console.warn('[detectEditors] mdfind failed, falling back to path scanning', error)
    return []
  }
}

async function findAppsViaFallbackPaths(): Promise<string[]> {
  const appNames = [
    'Visual Studio Code',
    'Cursor',
    'Zed',
    'Sublime Text',
    'Nova',
    'Xcode',
    'IntelliJ IDEA',
    'IntelliJ IDEA CE',
    'WebStorm',
    'PyCharm',
    'PyCharm CE',
    'GoLand',
    'RustRover',
    'PhpStorm',
    'RubyMine',
    'CLion',
    'Rider',
    'DataGrip',
    'Android Studio',
    'Antigravity',
    'OpenCode',
    'Codex',
  ]
  const discovered: string[] = []
  for (const appName of appNames) {
    const candidates = [
      path.join('/Applications', `${appName}.app`),
      path.join(homedir(), 'Applications', `${appName}.app`),
      path.join('/Applications/JetBrains Toolbox', `${appName}.app`),
    ]
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        discovered.push(candidate)
      }
    }
  }
  return discovered
}

function isGuiEditorApp(appPath: string): boolean {
  const name = path.basename(appPath, '.app')
  const nameLower = name.toLowerCase()

  const ignoreSubstrings = [
    'helper',
    'url handler',
    'feedback',
    'installer',
    'uninstall',
    'create ml',
    'instruments',
    'simulator',
    'lobrecs agent',
    'claude',
    'ollama',
    'docker',
    'trezor suite',
    'drata agent',
    'testflight',
    'lm studio',
    'electron',
    'license',
  ]
  if (ignoreSubstrings.some((sub) => nameLower.includes(sub))) {
    return false
  }

  return ID_MAPPINGS.some((mapping) => nameLower.includes(mapping.keyword))
}

let cached: EditorInfo[] | null = null

/**
 * macOS-only. Detects installed GUI editors by probing Spotlight (mdfind)
 * and falling back to scanning common directory paths. Results are cached for the
 * lifetime of the main process — call invalidateEditorCache() to refresh.
 */
export async function detectEditors(): Promise<EditorInfo[]> {
  if (cached) return cached
  if (process.platform !== 'darwin') {
    cached = []
    return cached
  }

  const spotlightPaths = await findAppsViaSpotlight()
  const fallbackPaths = await findAppsViaFallbackPaths()
  const allPaths = Array.from(new Set([...spotlightPaths, ...fallbackPaths]))

  const guiEditors: EditorInfo[] = []
  const usedIds = new Set<string>()

  const sortedMappings = [...ID_MAPPINGS].sort((a, b) => b.keyword.length - a.keyword.length)

  for (const appPath of allPaths) {
    if (!isGuiEditorApp(appPath)) {
      continue
    }

    const appName = path.basename(appPath, '.app')
    const appNameLower = appName.toLowerCase()

    const mapping = sortedMappings.find((m) => appNameLower.includes(m.keyword))
    if (!mapping) continue

    let id = mapping.id
    if (usedIds.has(id)) {
      const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      id = slug
      let counter = 1
      while (usedIds.has(id)) {
        id = `${slug}-${counter}`
        counter++
      }
    }

    usedIds.add(id)
    guiEditors.push({
      id,
      name: appName,
      kind: 'gui',
      target: appPath,
    })
  }

  const virtualEditors: EditorInfo[] = [
    { id: 'default-app', name: 'Default app', kind: 'gui', target: 'default-app' },
    { id: 'open-in-folder', name: 'Open in folder', kind: 'gui', target: 'open-in-folder' },
  ]

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

  const cliResults = await Promise.all(cliPromises)
  const cliEditors = cliResults.filter((e): e is EditorInfo => e !== null)

  cached = [...guiEditors, ...virtualEditors, ...cliEditors]
  return cached
}

export function invalidateEditorCache(): void {
  cached = null
}
