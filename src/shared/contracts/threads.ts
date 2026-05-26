import type { Project } from './projects'
import {
  assertPlainId,
  assertRecord,
  assertString,
  optionalBoolean,
  optionalInteger,
} from './validation'

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

export interface SearchThreadsInput {
  query: string
  limit?: number
  includeArchived?: boolean
}

export type ThreadSearchMatchKind = 'recent' | 'thread' | 'project' | 'prompt' | 'message'

export interface ThreadSearchResult {
  thread: Thread
  project: Project
  sessionId?: string
  matchKind: ThreadSearchMatchKind
  matchText: string
  updatedAt: number
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

export function validateThreadId(input: unknown): string {
  return assertPlainId(input, 'Thread id')
}

export function validateListThreadsInput(
  projectId: unknown,
  opts: unknown,
): { projectId: string; opts?: ListThreadsOptions } {
  const parsedProjectId = assertPlainId(projectId, 'Project id')
  if (opts === undefined || opts === null) return { projectId: parsedProjectId }
  const value = assertRecord(opts, 'Thread list options')
  return {
    projectId: parsedProjectId,
    opts: {
      includeArchived: optionalBoolean(value.includeArchived, 'Include archived'),
    },
  }
}

export function validateSearchThreadsInput(input: unknown): SearchThreadsInput {
  const value = assertRecord(input, 'Thread search input')
  return {
    query: assertString(value.query, 'Search query', { maxLength: 500, allowEmpty: true }),
    limit: optionalInteger(value.limit, 'Search limit', { min: 1, max: 50 }),
    includeArchived: optionalBoolean(value.includeArchived, 'Include archived'),
  }
}

export function validateCreateThreadInput(input: unknown): CreateThreadInput {
  const value = assertRecord(input, 'Thread input')
  return {
    projectId: assertPlainId(value.projectId, 'Project id'),
    title: assertString(value.title, 'Thread title', { maxLength: 200 }),
  }
}

export function validateRenameThreadInput(input: unknown): { id: string; title: string } {
  const value = assertRecord(input, 'Thread rename input')
  return {
    id: assertPlainId(value.id, 'Thread id'),
    title: assertString(value.title, 'Thread title', { maxLength: 200 }),
  }
}

export function validatePinThreadInput(input: unknown): { id: string; pinned: boolean } {
  const value = assertRecord(input, 'Thread pin input')
  const pinned = value.pinned
  if (typeof pinned !== 'boolean') throw new Error('Pinned must be a boolean.')
  return {
    id: assertPlainId(value.id, 'Thread id'),
    pinned,
  }
}
