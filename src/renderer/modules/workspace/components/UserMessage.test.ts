import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { isPlanModeExecutionPrompt } from './PlanModeExecutionMessage'
import { UserMessage } from './UserMessage'

const planExecutionPrompt = [
  '[Plan Mode] Your plan has been approved.',
  'Execute it now in full: make the file changes and run the steps you',
  'described in the plan above. Follow the plan as written; if you must',
  'deviate, briefly explain why.',
].join('\n')

describe('UserMessage', () => {
  it('renders the internal plan-mode execution prompt as a status card', () => {
    const html = renderToStaticMarkup(
      createElement(UserMessage, {
        text: planExecutionPrompt,
      }),
    )

    expect(isPlanModeExecutionPrompt(planExecutionPrompt)).toBe(true)
    expect(html).toContain('Plan approved')
    expect(html).toContain('Execution session started')
    expect(html).not.toContain('Execute it now in full')
  })

  it('keeps normal prompts as user markdown bubbles', () => {
    const html = renderToStaticMarkup(
      createElement(UserMessage, {
        text: 'Please implement the approved plan.',
      }),
    )

    expect(html).toContain('Please implement the approved plan.')
    expect(html).not.toContain('Execution session started')
  })
})
