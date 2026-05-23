interface BuildPrDraftPromptInput {
  headBranch: string
  baseBranch: string
  commits: string
  diffStat: string
  template: string
  diff?: string
}

export function buildPrDraftPrompt(input: BuildPrDraftPromptInput): string {
  const template = input.template.trim()

  return [
    'Generate a pull request title and description for these Git changes.',
    `Source branch: ${input.headBranch} -> Target: ${input.baseBranch}`,
    template
      ? [
          '\nPull request template to follow:',
          '```markdown',
          template,
          '```',
          'Use the template above as the body structure. Preserve its headings and checklist items, and replace placeholder comments with concise details when the changes provide enough context.',
        ].join('\n')
      : '',
    input.commits ? `\nRecent commits:\n${input.commits}` : '',
    input.diffStat ? `\nChanged files:\n${input.diffStat}` : '',
    input.diff ? `\nCode diff:\n${input.diff}` : '',
    '\nRespond with ONLY a JSON object (no markdown fences, no extra text):',
    '{"title":"concise PR title under 72 chars","body":"markdown PR description that follows the provided template"}',
  ].filter(Boolean).join('\n')
}

export function createDraftTitle(headBranch: string, baseBranch: string): string {
  const normalized = headBranch
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^[a-z]+\/+/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()

  const summary = normalized.length > 0
    ? normalized
    : `changes from ${headBranch || 'current branch'}`

  const sentence = capitalize(summary)
  return `feat: ${sentence} -> ${baseBranch.trim() || 'main'}`
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
