import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DEFAULT_EXECUTABLE_PATHS = [
  path.dirname(process.execPath),
  path.join(homedir(), '.local', 'bin'),
  path.join(homedir(), '.codex', 'bin'),
  path.join(homedir(), '.claude', 'local'),
  path.join(homedir(), '.claude', 'local', 'bin'),
  path.join(homedir(), '.npm-global', 'bin'),
  path.join(homedir(), '.opencode', 'bin'),
  path.join(homedir(), '.gemini', 'bin'),
  path.join(homedir(), '.bun', 'bin'),
  path.join(homedir(), '.cargo', 'bin'),
  path.join(homedir(), '.asdf', 'shims'),
  path.join(homedir(), '.volta', 'bin'),
  path.join(homedir(), '.nodenv', 'shims'),
  path.join(homedir(), 'n', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

export function buildProcessEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides }
  env.PATH = buildExecutableSearchPath(env.PATH)
  return env
}

export function getUserShell(env: NodeJS.ProcessEnv = process.env): string {
  const configuredShell = env.SHELL?.trim()
  if (configuredShell) return configuredShell

  if (process.platform === 'darwin') return '/bin/zsh'
  if (process.platform === 'linux') return '/bin/bash'
  if (process.platform === 'win32') return env.ComSpec?.trim() || 'cmd.exe'

  return '/bin/sh'
}

export function buildExecutableSearchPath(existingPath = ''): string {
  return uniquePaths([
    ...splitPath(existingPath),
    ...DEFAULT_EXECUTABLE_PATHS,
    ...nvmBinDirectories(),
  ]).join(path.delimiter)
}

export function resolveExecutable(command: string): string | null {
  if (!command || isPathLikeCommand(command)) return null

  for (const directory of splitPath(buildExecutableSearchPath(process.env.PATH))) {
    const candidate = path.join(directory, command)
    if (isExecutable(candidate)) return candidate
  }

  return null
}

function splitPath(value: string | undefined): string[] {
  return (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const candidate of paths) {
    if (seen.has(candidate)) continue

    seen.add(candidate)
    unique.push(candidate)
  }

  return unique
}

function nvmBinDirectories(): string[] {
  const nvmVersionsPath = path.join(homedir(), '.nvm', 'versions', 'node')

  try {
    return fs
      .readdirSync(nvmVersionsPath)
      .sort()
      .reverse()
      .map((version) => path.join(nvmVersionsPath, version, 'bin'))
  } catch {
    return []
  }
}

function isPathLikeCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}
