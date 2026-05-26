import type { PullRequestDiffSnapshot } from '../../../../shared/types'

const MAX_PROMPT_CHARS = 120_000

export function buildPrReviewPrompt(snapshot: PullRequestDiffSnapshot): string {
  const changedFilesBlock = snapshot.changedFiles
    .map((file) =>
      file.previousPath
        ? `- ${file.status}: ${file.previousPath} -> ${file.path}`
        : `- ${file.status}: ${file.path}`,
    )
    .join('\n')

  const sections = [
    `You are reviewing pull request #${snapshot.prNumber} ("${snapshot.title}") on ${snapshot.repoSlug}.`,
    `Base branch: ${snapshot.baseBranch} (${snapshot.baseSha || 'unknown'})`,
    `Head branch: ${snapshot.headBranch} (${snapshot.headSha || 'unknown'})`,
    '',
    'Return valid JSON only. No markdown fences. No extra prose.',
    'Focus only on concrete issues introduced by the diff: bugs, regressions, security risks, missing tests, and verification gaps.',
    'Do not praise the code. Do not invent issues. If there are no concrete findings, return an empty findings array.',
    '',
    'JSON schema:',
    '{',
    '  "summary": "One short sentence.",',
    '  "findings": [',
    '    {',
    '      "severity": "critical | high | medium | low",',
    '      "category": "bug | regression | security | missing-test | verification",',
    '      "title": "Short finding title",',
    '      "detail": "Why this is a real issue in this diff.",',
    '      "filePath": "relative/path.ts",',
    '      "line": 123,',
    '      "recommendation": "Concrete fix or verification step."',
    '    }',
    '  ]',
    '}',
    '',
    'Changed files:',
    changedFilesBlock || '(no changed files)',
    '',
    'Diff stat:',
    snapshot.diffStat || '(no diff stat available)',
    '',
    'Patch:',
    trimPromptSection(snapshot.patch || '(patch is empty)'),
  ]

  return trimPromptSection(sections.join('\n'))
}

function trimPromptSection(text: string): string {
  if (text.length <= MAX_PROMPT_CHARS) return text
  return `${text.slice(0, MAX_PROMPT_CHARS).trimEnd()}\n[truncated]`
}
