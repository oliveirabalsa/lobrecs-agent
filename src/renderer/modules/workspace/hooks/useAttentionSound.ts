import { useEffect, useRef } from 'react'
import type { SessionStatus } from '../../../../shared/types'
import {
  playAttentionSound,
  shouldPlayAttentionSound,
  type AttentionEvent,
} from '../../../lib/attentionSound'

interface AttentionSoundInput {
  /** `promptId` of the question currently waiting on the user, or `null`. */
  questionPromptId: string | null
  /** True while an approval request is pending. */
  approvalPending: boolean
  /** Latest session status — drives the complete / error chimes. */
  status: SessionStatus | null
}

/** Terminal statuses that should chime, mapped to their attention event. */
const TERMINAL_STATUS_EVENT: Partial<Record<SessionStatus, AttentionEvent>> = {
  done: 'session-complete',
  error: 'error',
}

/** Runs the play decision through the policy, gated on current window focus. */
function chime(event: AttentionEvent): void {
  const focused = typeof document === 'undefined' ? true : document.hasFocus()
  if (shouldPlayAttentionSound(event, focused)) playAttentionSound()
}

/**
 * Plays the attention chime when the agent transitions into a state that
 * needs the user: a new question, a new approval request, or a finished run.
 *
 * Each trigger is edge-triggered — it fires once per *transition* via the
 * `prev*` refs, never on every render while the state simply persists.
 */
export function useAttentionSound({
  questionPromptId,
  approvalPending,
  status,
}: AttentionSoundInput): void {
  const prevQuestionId = useRef<string | null>(null)
  const prevApprovalPending = useRef(false)
  const prevStatus = useRef<SessionStatus | null>(null)

  useEffect(() => {
    if (questionPromptId && questionPromptId !== prevQuestionId.current) {
      chime('question')
    }
    prevQuestionId.current = questionPromptId
  }, [questionPromptId])

  useEffect(() => {
    if (approvalPending && !prevApprovalPending.current) {
      chime('approval')
    }
    prevApprovalPending.current = approvalPending
  }, [approvalPending])

  useEffect(() => {
    const event = status ? TERMINAL_STATUS_EVENT[status] : undefined
    if (event && status !== prevStatus.current) {
      chime(event)
    }
    prevStatus.current = status
  }, [status])
}
