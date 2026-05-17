import { getDb } from './db'

export type FeedbackOutcome = 'success' | 'failure' | 'partial'

export type SessionFeedback = {
  sessionId: string
  outcome: FeedbackOutcome
  userNote?: string
  createdAt: number
}

export type RecentFailure = {
  sessionId: string
  prompt: string
  model: string
  outcome: FeedbackOutcome
  createdAt: number
}

const allowedOutcomes = new Set<FeedbackOutcome>(['success', 'failure', 'partial'])

type FeedbackRow = {
  session_id: string
  outcome: FeedbackOutcome
  user_note: string | null
  created_at: number
}

type RecentFailureRow = {
  session_id: string
  prompt: string
  model: string
  outcome: FeedbackOutcome
  created_at: number
}

export const feedbackStore = {
  save(sessionId: string, outcome: FeedbackOutcome, note?: string): SessionFeedback {
    assertOutcome(outcome)

    const now = Date.now()
    getDb()
      .prepare(
        `
          INSERT OR REPLACE INTO session_feedback (session_id, outcome, user_note, created_at)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(sessionId, outcome, note ?? null, now)

    return requireFeedback(sessionId)
  },

  get(sessionId: string): SessionFeedback | null {
    const row = getDb()
      .prepare('SELECT * FROM session_feedback WHERE session_id = ?')
      .get(sessionId) as FeedbackRow | undefined

    return row ? rowToFeedback(row) : null
  },

  getRecentFailures(projectId: string, limit = 20): RecentFailure[] {
    const rows = getDb()
      .prepare(
        `
          SELECT
            s.id AS session_id,
            s.prompt,
            s.model,
            sf.outcome,
            sf.created_at
          FROM sessions s
          JOIN session_feedback sf ON sf.session_id = s.id
          WHERE s.project_id = ? AND sf.outcome = 'failure'
          ORDER BY s.created_at DESC
          LIMIT ?
        `,
      )
      .all(projectId, Math.max(1, limit)) as RecentFailureRow[]

    return rows.map((row) => ({
      sessionId: row.session_id,
      prompt: row.prompt,
      model: row.model,
      outcome: row.outcome,
      createdAt: row.created_at,
    }))
  },
}

function rowToFeedback(row: FeedbackRow): SessionFeedback {
  return {
    sessionId: row.session_id,
    outcome: row.outcome,
    userNote: row.user_note ?? undefined,
    createdAt: row.created_at,
  }
}

function requireFeedback(sessionId: string): SessionFeedback {
  const feedback = feedbackStore.get(sessionId)
  if (!feedback) {
    throw new Error(`Feedback not found for session: ${sessionId}`)
  }

  return feedback
}

function assertOutcome(outcome: FeedbackOutcome): void {
  if (!allowedOutcomes.has(outcome)) {
    throw new Error(`Unsupported feedback outcome: ${outcome}`)
  }
}
