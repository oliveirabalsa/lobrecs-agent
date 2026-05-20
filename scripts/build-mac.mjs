import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  'macOS publish builds must be notarized. Set one complete notarization credential group: APPLE_API_KEY or APPLE_API_KEY_BASE64 + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE.'
const CODE_SIGNING_HELP =
  'macOS publish builds must be signed with a Developer ID Application certificate. Set CSC_LINK/CSC_KEY_PASSWORD, set CSC_NAME for an installed certificate, or install a Developer ID Application identity in the macOS keychain.'
const UNSIGNED_PUBLISH_HELP =
  'Unsigned macOS builds cannot be published to the auto-update feed. Build unsigned artifacts locally with `npm run build:mac` and publish only Developer ID signed and notarized macOS releases.'
const APPLE_API_KEY_FILENAME = 'AuthKey.p8'

export async function main(argv = process.argv.slice(2), env = process.env) {
  const publish = argv.includes('--publish')
  const allowUnsignedPublish = argv.includes('--allow-unsigned')
  const builderArgs = createMacBuilderArgs(publish, {
    allowUnsignedPublish,
  })

  let exitCode = 0
  let builderEnvContext = null

  try {
    if (publish && !allowUnsignedPublish) {
      validateMacPublishEnvironment(env)
      builderEnvContext = createElectronBuilderEnvContext(env)
    }

    await run('npm', ['run', 'build'])
    await run('npm', ['run', 'rebuild:electron'])
    await run('electron-builder', builderArgs, {
      env: builderEnvContext?.env ?? env,
    })
  } catch (error) {
    reportError(error)
    exitCode = getExitCode(error)
  } finally {
    builderEnvContext?.cleanup()

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
  return createElectronBuilderEnvContext(env, getGhToken).env
}

export function createElectronBuilderEnvContext(
  env = process.env,
  getGhToken = getGhCliToken,
  {
    createTempDir = createAppleApiKeyTempDir,
    writeFile = writeFileSync,
    removeDir = removeTempDir,
  } = {},
) {
  const builderEnv = {
    ...env,
    GH_TOKEN: resolvePublishToken(env, getGhToken),
  }
  const preparedApiKey = prepareAppleApiKeyForElectronBuilder(builderEnv, {
    createTempDir,
    writeFile,
    removeDir,
  })

  if (!preparedApiKey) {
    return {
      env: builderEnv,
      cleanup: noop,
    }
  }

  return {
    env: {
      ...builderEnv,
      APPLE_API_KEY: preparedApiKey.path,
    },
    cleanup: preparedApiKey.cleanup,
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
  const apiKey =
    normalizeToken(env.APPLE_API_KEY) ?? normalizeToken(env.APPLE_API_KEY_BASE64)
  const profiles = [
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    ['APPLE_KEYCHAIN_PROFILE'],
  ]

  if (
    apiKey &&
    normalizeToken(env.APPLE_API_KEY_ID) &&
    normalizeToken(env.APPLE_API_ISSUER)
  ) {
    return ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
  }

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

function prepareAppleApiKeyForElectronBuilder(
  env,
  { createTempDir, writeFile, removeDir },
) {
  const apiKey = normalizeToken(env.APPLE_API_KEY)
  if (apiKey) {
    if (isAppleApiKeyPath(apiKey)) {
      return null
    }

    const rawPrivateKey = normalizeAppleApiKeyContents(apiKey)
    if (rawPrivateKey) {
      return writeAppleApiKeyFile(rawPrivateKey, {
        createTempDir,
        writeFile,
        removeDir,
      })
    }
  }

  const base64ApiKey = normalizeToken(env.APPLE_API_KEY_BASE64)
  if (!base64ApiKey) {
    return null
  }

  const rawPrivateKey = normalizeAppleApiKeyContents(base64ApiKey)
  if (!rawPrivateKey) {
    return null
  }

  return writeAppleApiKeyFile(rawPrivateKey, {
    createTempDir,
    writeFile,
    removeDir,
  })
}

function normalizeAppleApiKeyContents(value) {
  if (looksLikePrivateKey(value)) {
    return ensureTrailingNewline(value)
  }

  try {
    const decodedValue = Buffer.from(value, 'base64').toString('utf8')
    if (looksLikePrivateKey(decodedValue)) {
      return ensureTrailingNewline(decodedValue)
    }
  } catch {
    return null
  }

  return null
}

function writeAppleApiKeyFile(
  rawPrivateKey,
  { createTempDir, writeFile, removeDir },
) {
  const tempDir = createTempDir()
  const apiKeyPath = path.join(tempDir, APPLE_API_KEY_FILENAME)
  writeFile(apiKeyPath, rawPrivateKey, { mode: 0o600 })

  return {
    path: apiKeyPath,
    cleanup: () => removeDir(tempDir),
  }
}

function createAppleApiKeyTempDir() {
  return mkdtempSync(path.join(tmpdir(), 'lobrecs-agent-notarize-'))
}

function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true })
}

function isAppleApiKeyPath(value) {
  return (
    value.endsWith('.p8') ||
    value.includes('/') ||
    value.includes('\\') ||
    existsSync(value)
  )
}

function looksLikePrivateKey(value) {
  return value.includes('-----BEGIN PRIVATE KEY-----')
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`
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

function noop() {}

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
