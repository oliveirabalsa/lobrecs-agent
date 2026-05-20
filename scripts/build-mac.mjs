import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BUILDER_ARGS = ['--mac', '--config.npmRebuild=false']
const PUBLISH_BUILDER_ARGS = [
  '--publish',
  'always',
]
const SIGNED_AND_NOTARIZED_PUBLISH_ARGS = [
  '--config.mac.forceCodeSigning=true',
  '--config.mac.notarize=true',
]
const PUBLISH_HELP =
  'Publishing requires GH_TOKEN or GITHUB_TOKEN, or an authenticated GitHub CLI session. Run `gh auth login` or export GH_TOKEN before `npm run release:mac`.'
const NOTARIZATION_HELP =
  'macOS publish builds must be notarized. Set one complete notarization credential group: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE.'
const CODE_SIGNING_HELP =
  'macOS publish builds must be signed with a Developer ID Application certificate. Set CSC_LINK/CSC_KEY_PASSWORD, set CSC_NAME for an installed certificate, or install a Developer ID Application identity in the macOS keychain.'
const UNSIGNED_PUBLISH_HELP =
  'Unsigned macOS builds cannot be published to the auto-update feed. Build unsigned artifacts locally with `npm run build:mac` and publish only Developer ID signed and notarized macOS releases.'

export async function main(argv = process.argv.slice(2), env = process.env) {
  const publish = argv.includes('--publish')
  const allowUnsignedPublish = argv.includes('--allow-unsigned')
  const builderArgs = createMacBuilderArgs(publish, {
    allowUnsignedPublish,
  })

  let exitCode = 0

  try {
    if (publish && !allowUnsignedPublish) {
      validateMacPublishEnvironment(env)
    }

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

export function createMacBuilderArgs(publish = false, options = {}) {
  const { allowUnsignedPublish = false } = options
  if (publish && allowUnsignedPublish) {
    throw new Error(UNSIGNED_PUBLISH_HELP)
  }

  return publish
    ? [
      ...DEFAULT_BUILDER_ARGS,
      ...PUBLISH_BUILDER_ARGS,
      ...SIGNED_AND_NOTARIZED_PUBLISH_ARGS,
    ]
    : [...DEFAULT_BUILDER_ARGS]
}

export function validateMacPublishEnvironment(
  env = process.env,
  {
    platform = process.platform,
    hasLocalDeveloperIdApplicationIdentity = findLocalDeveloperIdApplicationIdentity,
  } = {},
) {
  const notarizationProfile = resolveNotarizationProfile(env)
  if (!notarizationProfile) {
    throw new Error(NOTARIZATION_HELP)
  }

  if (!hasCodeSigningMaterial(env, platform, hasLocalDeveloperIdApplicationIdentity)) {
    throw new Error(CODE_SIGNING_HELP)
  }
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

function resolveNotarizationProfile(env) {
  const profiles = [
    ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    ['APPLE_KEYCHAIN_PROFILE'],
  ]

  return profiles.find(profile => profile.every(name => normalizeToken(env[name])))
}

function hasCodeSigningMaterial(env, platform, hasLocalDeveloperIdApplicationIdentity) {
  if (normalizeToken(env.CSC_LINK) || normalizeToken(env.CSC_NAME)) {
    return true
  }

  if (platform !== 'darwin' || isExplicitlyFalse(env.CSC_IDENTITY_AUTO_DISCOVERY)) {
    return false
  }

  return hasLocalDeveloperIdApplicationIdentity()
}

function findLocalDeveloperIdApplicationIdentity() {
  try {
    const identities = execFileSync(
      '/usr/bin/security',
      ['find-identity', '-v', '-p', 'codesigning'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )

    return identities
      .split('\n')
      .some(line => line.includes('Developer ID Application:'))
  } catch {
    return false
  }
}

function isExplicitlyFalse(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'false'
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
