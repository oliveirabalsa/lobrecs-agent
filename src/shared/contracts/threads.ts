/**
 * A Thread groups one or more sessions under a project, providing a Codex-style
 * conversation timeline. Threads carry their own metadata (title, pin state,
 * archive state) independent of the sessions they contain.
 */
export interface Thread {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  lastSessionId?: string
  /** Unix ms — presence means archived. */
  archivedAt?: number
}

export interface CreateThreadInput {
  projectId: string
  title: string
}

export interface UpdateThreadInput {
  title?: string
  pinned?: boolean
  lastSessionId?: string
  archivedAt?: number | null
}

export interface ListThreadsOptions {
  includeArchived?: boolean
}

/** Payload broadcast on `thread:updated` when thread metadata changes. */
export interface ThreadUpdatedEvent {
  threadId: string
  thread: Thread
}

/** Payload broadcast on `thread:deleted` after a thread is removed. */
export interface ThreadDeletedEvent {
  threadId: string
  projectId: string
}
