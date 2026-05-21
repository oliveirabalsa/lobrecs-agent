import type { DiffProposal } from '../../../../shared/types'

export function matchingDiffProposals(
  proposals: readonly DiffProposal[],
  filePath: string,
): DiffProposal[] {
  const exactMatches = proposals.filter((proposal) =>
    filePathsReferToSameFile(proposal.filePath, filePath),
  )
  if (exactMatches.length > 0) return exactMatches

  const fallbackName = basename(filePath)
  if (!fallbackName) return []

  const basenameMatches = proposals.filter((proposal) => basename(proposal.filePath) === fallbackName)
  return basenameMatches.length === 1 ? basenameMatches : []
}

export function filePathsReferToSameFile(leftPath: string, rightPath: string): boolean {
  const left = comparablePathSegments(leftPath)
  const right = comparablePathSegments(rightPath)

  if (left.length === 0 || right.length === 0) return false
  if (segmentsEqual(left, right)) return true

  return isSuffix(left, right) || isSuffix(right, left)
}

function comparablePathSegments(filePath: string): string[] {
  return filePath
    .trim()
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
}

function basename(filePath: string): string | undefined {
  return comparablePathSegments(filePath).at(-1)
}

function isSuffix(candidate: readonly string[], fullPath: readonly string[]): boolean {
  if (candidate.length > fullPath.length) return false

  const offset = fullPath.length - candidate.length
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== fullPath[offset + index]) return false
  }

  return true
}

function segmentsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((segment, index) => segment === right[index])
}
