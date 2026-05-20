import type { ModelTier, SupportedAgentId, ThinkingLevel } from './types'

/**
 * Visual-only formatter: turns canonical model IDs like `claude-opus-4-7`
 * into `Opus 4.7` for display. The underlying `modelId` in `ModelSelection`
 * is never rewritten — IPC + routing keep the canonical string.
 */
export function formatModelLabel(agentId: SupportedAgentId, modelId: string): string {
  if (agentId === 'claude-code') return formatClaude(modelId)
  if (agentId === 'codex') return formatCodex(modelId)
  if (agentId === 'opencode') return formatOpenCode(modelId)
  if (agentId === 'gemini') return formatGemini(modelId)
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

function formatGemini(modelId: string): string {
  if (modelId === 'flash-lite') return 'Gemini Flash Lite'
  if (modelId === 'flash') return 'Gemini Flash'
  if (modelId === 'pro') return 'Gemini Pro'
  if (modelId === 'auto') return 'Gemini Auto'
  return modelId.replace(/^gemini-/i, 'Gemini ')
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
  gemini: 'Gemini',
}

/** Advanced + Frontier tiers expose a thinking-depth control. */
export function supportsThinking(tier: ModelTier): boolean {
  return tier === 'advanced' || tier === 'frontier'
}

export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high']

export const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
