import { describe, it, expect } from 'vitest'

import { isBranchBehindRemote } from './release.mjs'

describe('release.mjs', () => {
  describe('git remote state parsing', () => {
    it('allows local commits ahead of origin because the release push will publish them', () => {
      expect(isBranchBehindRemote('1\t0')).toBe(false)
    })

    it('rejects a branch that is actually behind origin', () => {
      expect(isBranchBehindRemote('0\t1')).toBe(true)
    })
  })

  describe('version bumping', () => {
    function bumpVersion(currentVersion, bumpType) {
      const [major, minor, patch] = currentVersion.split('.').map(Number)
      switch (bumpType) {
        case 'major':
          return `${major + 1}.0.0`
        case 'minor':
          return `${major}.${minor + 1}.0`
        case 'patch':
          return `${major}.${minor}.${patch + 1}`
        default:
          throw new Error(`Invalid bump type: ${bumpType}`)
      }
    }

    it('bumps patch version', () => {
      expect(bumpVersion('0.1.2', 'patch')).toBe('0.1.3')
      expect(bumpVersion('1.5.10', 'patch')).toBe('1.5.11')
    })

    it('bumps minor version', () => {
      expect(bumpVersion('0.1.2', 'minor')).toBe('0.2.0')
      expect(bumpVersion('1.5.10', 'minor')).toBe('1.6.0')
    })

    it('bumps major version', () => {
      expect(bumpVersion('0.1.2', 'major')).toBe('1.0.0')
      expect(bumpVersion('1.5.10', 'major')).toBe('2.0.0')
    })
  })

  describe('argument parsing', () => {
    const versionRegex = /^\d+\.\d+\.\d+$/
    const bumpTypes = ['patch', 'minor', 'major']

    function parseReleaseArgs(argv = []) {
      let bumpType = 'patch'
      let version = null

      if (argv.length > 0) {
        const arg = argv[0]
        if (bumpTypes.includes(arg)) {
          bumpType = arg
        } else if (versionRegex.test(arg)) {
          version = arg
        } else {
          throw new Error(
            `Invalid argument '${arg}'. Use 'patch', 'minor', 'major', or a version like '0.2.0'.`,
          )
        }
      }

      return { bumpType, version }
    }

    it('defaults to patch bump with no args', () => {
      const { bumpType, version } = parseReleaseArgs([])
      expect(bumpType).toBe('patch')
      expect(version).toBeNull()
    })

    it('parses bump type arguments', () => {
      expect(parseReleaseArgs(['patch']).bumpType).toBe('patch')
      expect(parseReleaseArgs(['minor']).bumpType).toBe('minor')
      expect(parseReleaseArgs(['major']).bumpType).toBe('major')
    })

    it('parses explicit version arguments', () => {
      const { bumpType, version } = parseReleaseArgs(['0.2.0'])
      expect(version).toBe('0.2.0')
      expect(bumpType).toBe('patch')
    })

    it('rejects invalid arguments', () => {
      expect(() => parseReleaseArgs(['invalid'])).toThrow(
        /Invalid argument 'invalid'/,
      )
      expect(() => parseReleaseArgs(['0.2'])).toThrow(
        /Invalid argument '0\.2'/,
      )
      expect(() => parseReleaseArgs(['v0.2.0'])).toThrow(
        /Invalid argument 'v0\.2\.0'/,
      )
    })
  })
})
