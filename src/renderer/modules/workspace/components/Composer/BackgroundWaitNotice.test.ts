import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BackgroundWaitNotice } from './BackgroundWaitNotice'

describe('BackgroundWaitNotice', () => {
  it('renders the background-wait message as a non-blocking status callout', () => {
    const html = renderToStaticMarkup(
      createElement(BackgroundWaitNotice, {
        message: 'Waiting for QA repair agent.',
      }),
    )

    expect(html).toContain('Background repair running')
    expect(html).toContain('Non-blocking')
    expect(html).toContain('Waiting for QA repair agent.')
  })
})
