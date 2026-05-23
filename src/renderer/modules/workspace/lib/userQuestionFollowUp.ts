import type { AgentDispatchParams, SupportedAgentId } from '../../../../shared/types'
import { shouldContinuePlanModeAfterQuestionAnswer } from '../components/Composer/planMode'

export function buildUserQuestionFollowUpDispatchParams(input: {
  projectId: string
  prompt: string
  agentId?: SupportedAgentId
  modelOverride?: string
  threadId?: string | null
  planMode?: boolean | null
}): AgentDispatchParams {
  const params: AgentDispatchParams = {
    projectId: input.projectId,
    prompt: input.prompt,
    agentId: input.agentId,
    modelOverride: input.modelOverride,
    threadId: input.threadId ?? undefined,
  }

  if (shouldContinuePlanModeAfterQuestionAnswer(input.planMode)) {
    params.planMode = true
  }

  return params
}
