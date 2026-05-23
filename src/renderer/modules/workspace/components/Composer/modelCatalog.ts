import { formatModelLabel } from './modelDisplay'
import type { AgentModelCatalog, ModelGroup, ModelOption } from './types'

export const FALLBACK_MODEL_CATALOGS: AgentModelCatalog[] = [
  {
    agentId: 'claude-code',
    name: 'Claude Code',
    installed: true,
    models: [
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'claude-haiku-4-5',
        agentId: 'claude-code',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'claude-sonnet-4-6',
        agentId: 'claude-code',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'claude-opus-4-7',
        label: 'claude-opus-4-7',
        agentId: 'claude-code',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'codex',
    name: 'OpenAI Codex',
    installed: true,
    models: [
      {
        id: 'gpt-5.3-codex-spark',
        label: 'gpt-5.3-codex-spark',
        agentId: 'codex',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'gpt-5.3-codex',
        label: 'gpt-5.3-codex',
        agentId: 'codex',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        agentId: 'codex',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'opencode',
    name: 'OpenCode',
    installed: true,
    models: [
      {
        id: 'minimax-coding-plan/MiniMax-M2',
        label: 'minimax-coding-plan/MiniMax-M2',
        agentId: 'opencode',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'minimax-coding-plan/MiniMax-M2.5',
        label: 'minimax-coding-plan/MiniMax-M2.5',
        agentId: 'opencode',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'minimax-coding-plan/MiniMax-M2.7',
        label: 'minimax-coding-plan/MiniMax-M2.7',
        agentId: 'opencode',
        tier: 'advanced',
        source: 'fallback',
      },
    ],
  },
  {
    agentId: 'antigravity',
    name: 'Antigravity CLI',
    installed: true,
    models: [
      {
        id: 'gemini-2.0-flash-lite',
        label: 'gemini-2.0-flash-lite',
        agentId: 'antigravity',
        tier: 'lightweight',
        source: 'fallback',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'gemini-2.5-flash',
        agentId: 'antigravity',
        tier: 'balanced',
        source: 'fallback',
      },
      {
        id: 'gemini-3.0-pro',
        label: 'gemini-3.0-pro',
        agentId: 'antigravity',
        tier: 'advanced',
        source: 'fallback',
      },
      {
        id: 'gemini-3.5-pro',
        label: 'gemini-3.5-pro',
        agentId: 'antigravity',
        tier: 'frontier',
        source: 'fallback',
      },
    ],
  },
]

export function catalogOptions(catalogs: readonly AgentModelCatalog[]): ModelOption[] {
  return catalogs.flatMap((catalog) =>
    catalog.models.map((model) => ({
      key: `${catalog.agentId}:${model.id}`,
      agentId: catalog.agentId,
      agentName: catalog.name,
      modelId: model.id,
      label: formatModelLabel(catalog.agentId, model.label || model.id),
      tier: model.tier,
    })),
  )
}

export function groupModelOptions(
  catalogs: readonly AgentModelCatalog[],
): ModelGroup[] {
  return catalogs
    .filter((catalog) => catalog.installed && catalog.models.length > 0)
    .map((catalog) => ({
      agentId: catalog.agentId,
      label: catalog.name,
      options: catalogOptions([catalog]),
    }))
}
