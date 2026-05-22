import type { AgentEvent, DiffProposal } from '../../../../shared/types'
import { normalizeDiffPayload } from '../../../components/TerminalPanel/events'

export interface ThreadSessionEventBatch {
  sessionId: string
  createdAt: number
  events: readonly AgentEvent[]
}

export function diffProposalsFromThreadEvents(
  batches: readonly ThreadSessionEventBatch[],
): DiffProposal[] {
  const proposalsByPath = new Map<string, DiffProposal>()
  const orderedBatches = [...batches].sort((left, right) => left.createdAt - right.createdAt)

  for (const batch of orderedBatches) {
    const diffEvents = batch.events
      .filter((event) => event.type === 'diff')
      .sort((left, right) => left.timestamp - right.timestamp)

    for (const event of diffEvents) {
      for (const proposal of normalizeDiffPayload(event.payload)) {
        proposalsByPath.set(proposal.filePath, proposal)
      }
    }
  }

  return [...proposalsByPath.values()]
}

