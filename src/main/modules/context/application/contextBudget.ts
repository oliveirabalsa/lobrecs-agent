import { redactSensitiveText } from '../domain/secretRedaction'

export interface PromptContextSection {
  title: string
  content?: string | null
  maxChars?: number
}

export interface BuildBoundedPromptContextOptions {
  maxChars: number
}

const MIN_SECTION_CHARS = 300

export function buildBoundedPromptContext(
  sections: readonly PromptContextSection[],
  options: BuildBoundedPromptContextOptions,
): string | null {
  let remaining = Math.max(0, Math.floor(options.maxChars))
  const rendered: string[] = []

  for (const section of sections) {
    const content = redactSensitiveText(section.content?.trim() ?? '')
    if (!content || remaining <= 0) continue

    const budget = Math.min(
      remaining,
      Math.max(0, Math.floor(section.maxChars ?? remaining)),
    )
    if (budget < MIN_SECTION_CHARS && rendered.length > 0) break

    const block = formatSection(section.title, truncateForContext(content, budget))
    if (block.length <= remaining) {
      rendered.push(block)
      remaining -= block.length + 2
      continue
    }

    const adjustedBudget = remaining - section.title.length - 4
    if (adjustedBudget < MIN_SECTION_CHARS && rendered.length > 0) break

    rendered.push(formatSection(section.title, truncateForContext(content, adjustedBudget)))
    remaining = 0
  }

  return rendered.length > 0 ? rendered.join('\n\n') : null
}

export function truncateForContext(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  if (maxChars <= 16) return trimmed.slice(0, Math.max(0, maxChars)).trimEnd()

  return `${trimmed.slice(0, maxChars - 15).trimEnd()}\n[truncated]`
}

function formatSection(title: string, content: string): string {
  return `${title}\n${content}`
}
