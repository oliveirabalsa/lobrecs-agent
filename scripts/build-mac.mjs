import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BUILDER_ARGS = ['--mac', '--config.npmRebuild=false']
const PUBLISH_HELP =
  'Publishing requires GH_TOKEN or GITHUB_TOKEN, or an authenticated GitHub CLI session. Run `gh auth login` or export GH_TOKEN before `npm run release:mac`.'

export async function main(argv = process.argv.slice(2), env = process.env) {
  const publish = argv.includes('--publish')
  const builderArgs = [...DEFAULT_BUILDER_ARGS]

  if (publish) {
    builderArgs.push('--publish', 'always')
  }

  let exitCode = 0

  try {
    await run('npm', ['run', 'build'])
    await run('npm', ['run', 'rebuild:electron'])
    await run('electron-builder', builderArgs, {
      env: publish ? createElectronBuilderEnv(env) : env,
    })
  } catch (error) {
    reportError(error)
    exitCode = getExitCode(error)
  } finally {
    try {
      await run('npm', ['run', 'rebuild:node'])
    } catch (error) {
      reportError(error)
      exitCode = exitCode || getExitCode(error)
    }
  }

  return exitCode
}

export function createElectronBuilderEnv(
  env = process.env,
  getGhToken = getGhCliToken,
) {
  return {
    ...env,
    GH_TOKEN: resolvePublishToken(env, getGhToken),
  }
}

export function resolvePublishToken(env = process.env, getGhToken = getGhCliToken) {
  const envToken = normalizeToken(env.GH_TOKEN) ?? normalizeToken(env.GITHUB_TOKEN)
  if (envToken) return envToken

  try {
    const ghToken = normalizeToken(getGhToken())
    if (ghToken) return ghToken
  } catch (error) {
    throw new Error(`${PUBLISH_HELP} ${errorMessage(error)}`)
  }

  throw new Error(PUBLISH_HELP)
}

function getGhCliToken() {
  return execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function normalizeToken(token) {
  if (typeof token !== 'string') return null

  const trimmedToken = token.trim()
  return trimmedToken.length > 0 ? trimmedToken : null
}

function reportError(error) {
  const message = errorMessage(error)
  if (message.length > 0) {
    console.error(message)
  }
}

function errorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

function getExitCode(error) {
  return typeof error?.exitCode === 'number' ? error.exitCode : 1
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
  process.exitCode = await main()
}
