import { describe, expect, it } from 'vitest'
import { buildUserQuestionFollowUpDispatchParams } from './userQuestionFollowUp'

describe('buildUserQuestionFollowUpDispatchParams', () => {
  it('keeps the planning gate active when answering questions from a plan-mode session', () => {
    expect(
      buildUserQuestionFollowUpDispatchParams({
        projectId: 'project-1',
        prompt: 'Answers to your questions:\n\nQ: Scope?\nA: Renderer',
        agentId: 'codex',
        modelOverride: 'gpt-5.3-codex',
        threadId: 'thread-1',
        planMode: true,
      }),
    ).toMatchObject({
      projectId: 'project-1',
      agentId: 'codex',
      modelOverride: 'gpt-5.3-codex',
      threadId: 'thread-1',
      planMode: true,
    })
  })

  it('does not enable plan mode for normal question answers', () => {
    expect(
      buildUserQuestionFollowUpDispatchParams({
        projectId: 'project-1',
        prompt: 'Answers to your questions:',
        planMode: false,
      }),
    ).not.toHaveProperty('planMode')
  })
})
