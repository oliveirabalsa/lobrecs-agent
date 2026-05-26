import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type { Project } from '../../../../shared/types'

const TRUSTED_GENERATED_ROOTS = [
  path.join(homedir(), '.gemini', 'antigravity-cli', 'brain'),
]

const TRUSTED_TEMP_ROOTS = [
  path.join(tmpdir(), 'lobrecs-agent'),
]

export function resolveTrustedPath(filePath: string): string {
  return path.resolve(filePath)
}

export function assertInsideProjectOrTrustedRoots(
  filePath: string,
  projects: Pick<Project, 'repoPath'>[],
  message: string,
): string {
  const resolved = resolveTrustedPath(filePath)
  const projectRoots = projects.map((project) => project.repoPath)

  if (
    projectRoots.some((root) => isPathInside(root, resolved)) ||
    isTrustedGeneratedOrTempPath(resolved)
  ) {
    return resolved
  }

  throw new Error(message)
}

export function assertKnownProjectRoot(
  repoPath: string,
  projects: Pick<Project, 'repoPath'>[],
): string {
  const resolved = resolveTrustedPath(repoPath)
  if (projects.some((project) => path.resolve(project.repoPath) === resolved)) {
    return resolved
  }

  throw new Error('Repository path must match a saved project.')
}

export function isTrustedGeneratedMarkdownPath(filePath: string): boolean {
  const resolved = resolveTrustedPath(filePath)
  return TRUSTED_GENERATED_ROOTS.some((root) => isPathInside(root, resolved))
}

export function isTrustedGeneratedOrTempPath(filePath: string): boolean {
  const resolved = resolveTrustedPath(filePath)
  return (
    TRUSTED_GENERATED_ROOTS.some((root) => isPathInside(root, resolved)) ||
    TRUSTED_TEMP_ROOTS.some((root) => isPathInside(root, resolved))
  )
}

export function isPathInside(root: string, filePath: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(filePath)
  const relative = path.relative(resolvedRoot, resolved)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
