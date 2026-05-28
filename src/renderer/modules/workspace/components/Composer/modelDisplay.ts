import type { ModelTier, SupportedAgentId, ThinkingLevel } from './types'

/**
 * Visual-only formatter: turns canonical model IDs like `claude-opus-4-8`
 * into `Opus 4.8` for display. The underlying `modelId` in `ModelSelection`
 * is never rewritten — IPC + routing keep the canonical string.
 */
export function formatModelLabel(agentId: SupportedAgentId, modelId: string): string {
  if (agentId === 'claude-code') return formatClaude(modelId)
  if (agentId === 'codex') return formatCodex(modelId)
  if (agentId === 'opencode') return formatOpenCode(modelId)
  if (agentId === 'antigravity') return formatAntigravity(modelId)
  if (agentId === 'cursor') return formatCursor(modelId)
  return modelId
}

function formatClaude(modelId: string): string {
  const match = modelId.match(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)(?:-\d+)?$/i)
  if (!match) return modelId
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
  return `${family} ${match[2]}.${match[3]}`
}

function formatCodex(modelId: string): string {
  if (/^gpt-/i.test(modelId)) {
    return modelId
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-codex(-spark)?$/i, (_, spark) => (spark ? ' Codex Spark' : ' Codex'))
  }
  return modelId
}

function formatOpenCode(modelId: string): string {
  const trimmed = modelId.includes('/') ? modelId.slice(modelId.lastIndexOf('/') + 1) : modelId
  return trimmed.replace(/^MiniMax-/i, 'MiniMax ')
}

function formatAntigravity(modelId: string): string {
  if (modelId === 'flash-lite') return 'Gemini 1.5 Flash Lite'
  if (modelId === 'flash') return 'Gemini 1.5 Flash'
  if (modelId === 'pro') return 'Gemini 1.5 Pro'
  if (modelId === 'auto') return 'Gemini 2.0 Flash'

  return modelId
    .replace(/^(gemini|antigravity)-/i, (match) => match.charAt(0).toUpperCase() + match.slice(1, -1).toLowerCase() + ' ')
    .replace(/-flash-lite$/i, ' Flash Lite')
    .replace(/-flash$/i, ' Flash')
    .replace(/-pro$/i, ' Pro')
    .replace(/-/g, ' ')
}

function formatCursor(modelId: string): string {
  if (modelId === 'auto') return 'Auto'
  if (/^gpt-/i.test(modelId)) {
    return modelId.replace(/^gpt-/i, 'GPT-')
  }
  if (/^sonnet-\d(?:-thinking)?$/i.test(modelId)) {
    return modelId
      .replace(/^sonnet-/i, 'Sonnet ')
      .replace(/-thinking$/i, ' Thinking')
  }
  if (/^claude-\d-(sonnet|opus)(?:-thinking)?$/i.test(modelId)) {
    return modelId
      .replace(/^claude-/i, 'Claude ')
      .replace(/-(sonnet|opus)/i, (_, family: string) => ` ${family.charAt(0).toUpperCase()}${family.slice(1)}`)
      .replace(/-thinking$/i, ' Thinking')
  }
  return modelId.replace(/-/g, ' ')
}

export const TIER_LABEL: Record<ModelTier, string> = {
  lightweight: 'Lightweight',
  balanced: 'Balanced',
  advanced: 'Advanced',
  frontier: 'Frontier',
}

export const TIER_TONE: Record<ModelTier, string> = {
  lightweight: 'bg-accent-add/10 text-accent-add border-accent-add/30',
  balanced: 'bg-accent-primary/10 text-accent-primary border-accent-primary/30',
  advanced: 'bg-accent-warn/10 text-accent-warn border-accent-warn/30',
  frontier: 'bg-accent-del/10 text-accent-del border-accent-del/30',
}

export const AGENT_SHORT: Record<SupportedAgentId, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
}

/** Thinking support comes from the CLI model catalog, not broad model tiers. */
export function supportsThinking(
  model: { supportedThinkingLevels?: readonly Exclude<ThinkingLevel, 'off'>[] } | null,
): boolean {
  return (model?.supportedThinkingLevels?.length ?? 0) > 0
}

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

export const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}
