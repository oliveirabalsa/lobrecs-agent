import { describe, expect, it } from 'vitest'
import {
  captureLocalWebVisualEvidence,
  normalizeLocalWebUrl,
} from './localWebVisualEvidenceService'

describe('normalizeLocalWebUrl', () => {
  it('allows localhost web targets', () => {
    expect(normalizeLocalWebUrl('http://localhost:5173/app')).toBe(
      'http://localhost:5173/app',
    )
    expect(normalizeLocalWebUrl('https://preview.localhost/')).toBe(
      'https://preview.localhost/',
    )
  })

  it('rejects non-local targets', () => {
    expect(() => normalizeLocalWebUrl('https://example.com')).toThrow(
      /localhost targets/i,
    )
    expect(() => normalizeLocalWebUrl('file:///tmp/index.html')).toThrow(/http or https/i)
  })
})

describe('captureLocalWebVisualEvidence', () => {
  it('normalizes browser capture output into serializable evidence', async () => {
    const evidence = await captureLocalWebVisualEvidence(
      {
        url: 'http://127.0.0.1:3000/',
        viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
        replayNotes: 'Mobile checkout smoke.',
      },
      {
        runner: async (url, viewport) => ({
          finalUrl: `${url}checkout`,
          title: 'Checkout',
          screenshot: {
            width: viewport.width,
            height: viewport.height,
            sizeBytes: 42,
            dataUrl: 'data:image/png;base64,AAAA',
          },
          consoleErrors: [{ message: 'Hydration warning', createdAt: 11 }],
          networkFailures: [],
        }),
      },
    )

    expect(evidence).toMatchObject({
      kind: 'local-web',
      status: 'captured',
      url: 'http://127.0.0.1:3000/',
      finalUrl: 'http://127.0.0.1:3000/checkout',
      title: 'Checkout',
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
      screenshot: {
        mimeType: 'image/png',
        width: 390,
        height: 844,
        sizeBytes: 42,
        dataUrl: 'data:image/png;base64,AAAA',
      },
      consoleErrors: [{ message: 'Hydration warning', createdAt: 11 }],
      networkFailures: [],
      replayNotes: 'Mobile checkout smoke.',
    })
    expect(evidence.id).toHaveLength(36)
    expect(evidence.capturedAt).toBeGreaterThan(0)
  })

  it('marks evidence as failed when the browser sees network failures', async () => {
    const evidence = await captureLocalWebVisualEvidence(
      { url: 'http://localhost:9999/' },
      {
        runner: async () => ({
          consoleErrors: [],
          networkFailures: [
            {
              url: 'http://localhost:9999/',
              errorText: 'ERR_CONNECTION_REFUSED',
              createdAt: 12,
            },
          ],
        }),
      },
    )

    expect(evidence.status).toBe('failed')
    expect(evidence.networkFailures).toHaveLength(1)
  })
})
