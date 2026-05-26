import { describe, expect, it } from 'vitest'
import type { AgentModel, MultitaskTask } from '../../../../../shared/types'
import { replaceMultitaskTaskModel } from './MultitaskPlanCard'

describe('replaceMultitaskTaskModel', () => {
  const tasks: MultitaskTask[] = [
    {
      id: 'task-1',
      title: 'Renderer fix',
      description: 'Fix the renderer',
      tier: 'balanced',
      agentId: 'opencode',
      model: 'minimax-coding-plan/MiniMax-M2.5',
    },
    {
      id: 'task-2',
      title: 'Main fix',
      description: 'Fix the main process',
      tier: 'advanced',
      agentId: 'codex',
      model: 'gpt-5.4',
    },
  ]

  const models: AgentModel[] = [
    {
      id: 'claude-opus-4-7',
      label: 'claude-opus-4-7',
      agentId: 'claude-code',
      tier: 'frontier',
      source: 'fallback',
    },
  ]

  it('updates only the selected task model, agent, and tier', () => {
    const next = replaceMultitaskTaskModel(
      tasks,
      'task-1',
      { agentId: 'claude-code', modelId: 'claude-opus-4-7' },
      models,
    )

    expect(next[0]).toMatchObject({
      agentId: 'claude-code',
      model: 'claude-opus-4-7',
      tier: 'frontier',
    })
    expect(next[1]).toBe(tasks[1])
  })

  it('keeps the existing task tier when the selected model is not in the catalog', () => {
    const next = replaceMultitaskTaskModel(
      tasks,
      'task-1',
      { agentId: 'cursor', modelId: 'auto' },
      models,
    )

    expect(next[0]).toMatchObject({
      agentId: 'cursor',
      model: 'auto',
      tier: 'balanced',
    })
  })
})
