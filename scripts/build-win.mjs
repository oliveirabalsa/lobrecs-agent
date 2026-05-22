import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_BUILDER_ARGS = [
  '--win',
  '--config.npmRebuild=false',
  '--config.win.signAndEditExecutable=false',
]
const SYNC_EXCLUDES = new Set(['node_modules', 'dist-electron', 'out', '.git'])
const WINDOWS_USERS_ROOT = '/mnt/c/Users'
const IGNORED_WINDOWS_USERS = new Set([
  'All Users',
  'Default',
  'Default User',
  'Public',
  'Todos os Usuários',
  'Usuário Padrão',
  'desktop.ini',
])

export function createWinBuilderArgs() {
  return [...DEFAULT_BUILDER_ARGS]
}

export function isWsl() {
  if (process.platform !== 'linux') {
    return false
  }

  if (process.env.WSL_DISTRO_NAME) {
    return true
  }

  try {
    return readFileSync('/proc/version').includes('Microsoft')
  } catch {
    return false
  }
}

export function resolveWindowsUser(usersRoot = WINDOWS_USERS_ROOT) {
  if (!existsSync(usersRoot)) {
    throw new Error(
      'Windows user profile directory was not found. Run `npm run build:win` from Windows PowerShell instead.',
    )
  }

  const candidates = readdirSync(usersRoot)
    .filter(name => !IGNORED_WINDOWS_USERS.has(name))
    .filter(name => statSync(path.join(usersRoot, name)).isDirectory())

  if (candidates.length === 0) {
    throw new Error('No Windows user profile was found under /mnt/c/Users.')
  }

  return candidates[0]
}

export function resolveWindowsBuildDir(options = {}) {
  const usersRoot = options.usersRoot ?? WINDOWS_USERS_ROOT
  const windowsUser = options.windowsUser ?? resolveWindowsUser(usersRoot)
  return path.join(usersRoot, windowsUser, 'lobrecs-agent-build')
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (process.platform === 'win32') {
    return buildOnNativeWindows(env)
  }

  if (isWsl()) {
    return buildFromWsl(env)
  }

  throw new Error(
    'Building Windows installers from Linux requires Wine or WSL. Use WSL, or run `npm run build:win` from Windows PowerShell.',
  )
}

async function buildOnNativeWindows(env) {
  await run('npm', ['run', 'build'], { env: createBuilderEnv(env) })
  await run('electron-builder', createWinBuilderArgs(), { env: createBuilderEnv(env) })
  return 0
}

async function buildFromWsl(env) {
  const projectRoot = process.cwd()
  const windowsBuildDir = resolveWindowsBuildDir()
  const windowsBuildDirWin = toWindowsPath(windowsBuildDir)

  syncProjectToWindows(projectRoot, windowsBuildDir)

  const installNeeded = shouldInstallDependencies(projectRoot, windowsBuildDir)
  const installCommand = installNeeded ? 'npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ' : ''
  const buildCommand =
    `${installCommand}` +
    'npm run build; ' +
    `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ` +
    `npx electron-builder ${createWinBuilderArgs().join(' ')}`

  runWindowsCommand(buildCommand, windowsBuildDirWin, env)

  copyWindowsArtifacts(windowsBuildDir, projectRoot)
  console.log(`Windows installer copied to ${path.join(projectRoot, 'dist-electron')}`)
  return 0
}

function syncProjectToWindows(sourceRoot, targetRoot) {
  mkdirSync(targetRoot, { recursive: true })

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (SYNC_EXCLUDES.has(entry.name)) {
      continue
    }

    const sourcePath = path.join(sourceRoot, entry.name)
    const targetPath = path.join(targetRoot, entry.name)
    rmSync(targetPath, { recursive: true, force: true })
    cpSync(sourcePath, targetPath, { recursive: true })
  }
}

function shouldInstallDependencies(sourceRoot, targetRoot) {
  const sourceLock = path.join(sourceRoot, 'package-lock.json')
  const targetLock = path.join(targetRoot, 'package-lock.json')
  const targetModules = path.join(targetRoot, 'node_modules')

  if (!existsSync(targetModules) || !existsSync(targetLock)) {
    return true
  }

  return hashFile(sourceLock) !== hashFile(targetLock)
}

function copyWindowsArtifacts(windowsBuildDir, projectRoot) {
  const sourceDir = path.join(windowsBuildDir, 'dist-electron')
  const targetDir = path.join(projectRoot, 'dist-electron')

  if (!existsSync(sourceDir)) {
    throw new Error(`Windows build did not produce ${sourceDir}.`)
  }

  rmSync(targetDir, { recursive: true, force: true })
  cpSync(sourceDir, targetDir, { recursive: true })
}

function createBuilderEnv(env) {
  return {
    ...env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
}

function runWindowsCommand(command, windowsBuildDirWin, env) {
  const builderEnv = createBuilderEnv(env)
  const psCommand =
    `$ErrorActionPreference = 'Stop'; ` +
    `Set-Location '${windowsBuildDirWin.replace(/'/g, "''")}'; ` +
    `$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'; ` +
    command

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', psCommand],
    {
      env: builderEnv,
      stdio: 'inherit',
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Windows build failed with exit code ${result.status ?? 1}`)
  }
}

export function toWindowsPath(wslPath) {
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(wslPath)
  if (!match) {
    throw new Error(`Expected a /mnt/<drive>/ path, received ${wslPath}`)
  }

  const [, driveLetter, rest] = match
  return `${driveLetter.toUpperCase()}:\\${rest.replaceAll('/', '\\')}`
}

function hashFile(filePath) {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const error = new Error(
        signal
          ? `${command} ${args.join(' ')} exited with signal ${signal}`
          : `${command} ${args.join(' ')} exited with code ${code ?? 1}`,
      )
      error.exitCode = code ?? 1
      reject(error)
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
