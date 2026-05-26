import { describe, expect, it } from 'vitest'
import type { RunAuditRecord } from '../../../../../shared/types'
import { deriveRunAuditCommandRows, deriveVisualEvidenceRows } from './RunAuditTimelineCard'

function auditRecord(
  input: Partial<RunAuditRecord> & Pick<RunAuditRecord, 'id' | 'phase'>,
): RunAuditRecord {
  return {
    sessionId: 'session-1',
    attempt: 0,
    createdAt: 1,
    ...input,
  }
}

describe('deriveRunAuditCommandRows', () => {
  it('deduplicates repeated audit events into the latest command status', () => {
    const rows = deriveRunAuditCommandRows([
      auditRecord({
        id: 'started',
        phase: 'recipe-started',
        recipeLabel: 'Tests',
        command: 'rtk npm test',
        changedFiles: ['/repo/src/app.ts'],
      }),
      auditRecord({
        id: 'passed',
        phase: 'recipe-passed',
        recipeLabel: 'Tests',
        command: 'rtk npm test',
        exitCode: 0,
        changedFiles: ['/repo/src/app.ts'],
      }),
      auditRecord({
        id: 'gate-passed',
        phase: 'gate-passed',
        changedFiles: ['/repo/src/app.ts'],
        finalStatus: 'passed',
      }),
    ])

    expect(rows).toEqual([
      {
        command: 'rtk npm test',
        status: 'passed',
        attempt: 0,
        exitCode: 0,
      },
    ])
  })

  it('keeps only command-bearing audit records', () => {
    const rows = deriveRunAuditCommandRows([
      auditRecord({
        id: 'gate-passed',
        phase: 'gate-passed',
        changedFiles: ['/repo/src/app.ts'],
        finalStatus: 'passed',
      }),
    ])

    expect(rows).toEqual([])
  })

  it('marks a failed verification command without exposing output details', () => {
    const rows = deriveRunAuditCommandRows([
      auditRecord({
        id: 'failed',
        phase: 'recipe-failed',
        command: 'rtk npm run build',
        exitCode: 1,
        outputTail: 'large failure log',
      }),
    ])

    expect(rows).toEqual([
      {
        command: 'rtk npm run build',
        status: 'failed',
        attempt: 0,
        exitCode: 1,
      },
    ])
  })
})

describe('deriveVisualEvidenceRows', () => {
  it('maps visual evidence records into renderer artifact rows', () => {
    const rows = deriveVisualEvidenceRows([
      auditRecord({
        id: 'visual',
        phase: 'visual-captured',
        visualEvidence: {
          id: 'evidence-1',
          kind: 'local-web',
          status: 'captured',
          url: 'http://localhost:5173/',
          finalUrl: 'http://localhost:5173/app',
          title: 'App',
          viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
          screenshot: {
            mimeType: 'image/png',
            width: 390,
            height: 844,
            sizeBytes: 10,
            dataUrl: 'data:image/png;base64,AAAA',
          },
          consoleErrors: [{ message: 'boom', createdAt: 1 }],
          networkFailures: [
            {
              url: 'http://localhost:5173/api',
              errorText: 'ERR_FAILED',
              createdAt: 2,
            },
          ],
          replayNotes: 'Opened app shell.',
          capturedAt: 3,
        },
      }),
    ])

    expect(rows).toEqual([
      {
        id: 'evidence-1',
        status: 'captured',
        url: 'http://localhost:5173/',
        finalUrl: 'http://localhost:5173/app',
        title: 'App',
        viewport: '390x844 @2x',
        screenshotDataUrl: 'data:image/png;base64,AAAA',
        consoleErrorCount: 1,
        networkFailureCount: 1,
        replayNotes: 'Opened app shell.',
      },
    ])
  })
})
