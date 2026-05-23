import { describe, expect, it } from 'vitest'
import type { AgentModel } from '../../../../../shared/types'
import { selectDefaultFixModel } from './DiffReviewCard'

describe('selectDefaultFixModel', () => {
  const models: AgentModel[] = [
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
  ]

  it('keeps the current session model when it is available', () => {
    expect(
      selectDefaultFixModel(models, {
        agentId: 'codex',
        modelId: 'gpt-5.3-codex-spark',
      }),
    ).toEqual({
      agentId: 'codex',
      modelId: 'gpt-5.3-codex-spark',
    })
  })

  it('falls back to a balanced model for implementation work', () => {
    expect(selectDefaultFixModel(models, null)).toEqual({
      agentId: 'codex',
      modelId: 'gpt-5.3-codex',
    })
  })
})
