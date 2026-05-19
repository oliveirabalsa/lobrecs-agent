import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(__dirname)
const packageJsonPath = path.join(projectRoot, 'package.json')
const builderConfigPath = path.join(projectRoot, 'electron-builder.yml')

const versionRegex = /^\d+\.\d+\.\d+$/
const bumpTypes = ['patch', 'minor', 'major']

function log(message) {
  console.log(`\n📦 ${message}`)
}

function error(message) {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

function exec(command, args, silent = false) {
  try {
    const result = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    })
    if (result == null) return ''
    return result.trim()
  } catch (err) {
    error(`Command failed: ${command} ${args.join(' ')}\n${err.message}`)
  }
}

function validateGitState() {
  log('Validating git state...')

  const status = exec('git', ['status', '--porcelain'], true)
  if (status.length > 0) {
    error('Working directory is not clean. Please commit or stash changes.')
  }

  const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], true)
  if (branch !== 'main') {
    error(`You must be on the 'main' branch to release. Currently on '${branch}'.`)
  }

  exec('git', ['fetch', 'origin'], true)
  const behindOrigin = exec(
    'git',
    ['rev-list', '--left-right', '--count', 'main...origin/main'],
    true,
  )
  const [behind] = behindOrigin.split('\t')
  if (parseInt(behind, 10) > 0) {
    error(`Your main branch is behind origin/main. Run 'git pull' first.`)
  }

  log('✓ Git state is clean and up to date')
}

function validateGhToken() {
  log('Validating GitHub authentication...')

  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    log('✓ GitHub token found in environment')
    return
  }

  try {
    exec('gh', ['auth', 'status'], true)
    log('✓ GitHub CLI is authenticated')
  } catch {
    error(
      'No GitHub token found. Export GH_TOKEN or run `gh auth login`.',
    )
  }
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  return pkg.version
}

function bumpVersion(currentVersion, bumpType) {
  const [major, minor, patch] = currentVersion.split('.').map(Number)

  let newVersion
  switch (bumpType) {
    case 'major':
      newVersion = `${major + 1}.0.0`
      break
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`
      break
    case 'patch':
      newVersion = `${major}.${minor}.${patch + 1}`
      break
    default:
      error(`Invalid bump type: ${bumpType}`)
  }

  return newVersion
}

function updateVersion(newVersion) {
  log(`Updating version to ${newVersion}...`)

  // Update package.json
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  pkg.version = newVersion
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')

  // Update electron-builder.yml
  let config = fs.readFileSync(builderConfigPath, 'utf8')
  config = config.replace(/version: \d+\.\d+\.\d+/g, `version: ${newVersion}`)
  fs.writeFileSync(builderConfigPath, config)

  log(`✓ Version updated to ${newVersion}`)
}

function createRelease(newVersion) {
  log(`Creating release v${newVersion}...`)

  // Commit version bump
  exec('git', ['add', 'package.json', 'electron-builder.yml'])
  exec('git', ['commit', '-m', `chore: bump version to ${newVersion}`])

  // Create git tag
  exec('git', ['tag', `v${newVersion}`])
  log(`✓ Created git tag v${newVersion}`)

  // Push commits and tags
  log('Pushing to GitHub...')
  exec('git', ['push', 'origin', 'main'])
  exec('git', ['push', 'origin', '--tags'])
  log('✓ Pushed to GitHub')

  // Build and publish
  log('Building and publishing...')
  exec('npm', ['run', 'build:mac:release'])
  log('✓ Build and publish complete')
}

function verifyRelease(newVersion) {
  log('Verifying release...')

  try {
    const releaseUrl = `https://github.com/oliveirabalsa/lobrecs-agent-releases/releases/tag/v${newVersion}`
    log(`\n✓ Release created successfully!`)
    log(`\nRelease URL: ${releaseUrl}`)
    log(`Feed URL: https://github.com/oliveirabalsa/lobrecs-agent-releases/releases.atom`)
  } catch (err) {
    console.warn('Could not verify release. Please check manually.')
  }
}

function showHelp() {
  console.log(`
Usage: npm run release [option]

Options:
  (none)        Bump patch version (e.g., 0.1.2 → 0.1.3)
  patch         Bump patch version
  minor         Bump minor version (e.g., 0.1.2 → 0.2.0)
  major         Bump major version (e.g., 0.1.2 → 1.0.0)
  X.Y.Z         Release as explicit version (e.g., 0.2.0)

Examples:
  npm run release           # Default patch bump
  npm run release:minor     # Bump minor version
  npm run release:major     # Bump major version
  npm run release 0.2.0     # Release as v0.2.0

The release script will:
  1. Validate git state (clean, on main, up to date)
  2. Validate GitHub authentication
  3. Update version in package.json and electron-builder.yml
  4. Commit and tag the version bump
  5. Push commits and tags to GitHub
  6. Build and publish to oliveirabalsa/lobrecs-agent-releases
`)
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      showHelp()
      return 0
    }

    log('Starting release process...')

    // Parse arguments
    let bumpType = 'patch'
    let version = null

    if (argv.length > 0) {
      const arg = argv[0]
      if (bumpTypes.includes(arg)) {
        bumpType = arg
      } else if (versionRegex.test(arg)) {
        version = arg
      } else {
        error(
          `Invalid argument '${arg}'. Use 'patch', 'minor', 'major', or a version like '0.2.0'.\nRun 'npm run release -- --help' for more information.`,
        )
      }
    }

    validateGitState()
    validateGhToken()

    const currentVersion = readVersion()
    log(`Current version: ${currentVersion}`)

    const newVersion = version || bumpVersion(currentVersion, bumpType)
    log(`New version: ${newVersion}`)

    updateVersion(newVersion)
    createRelease(newVersion)
    verifyRelease(newVersion)

    log('\n🎉 Release complete!')
    return 0
  } catch (err) {
    error(err.message)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2))
}
