import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders common assistant markdown as structured React markup', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: [
          '## Summary',
          '',
          '- **Fixed** `threads.delete`',
          '- Render markdown',
          '',
          '```ts',
          'const ok = true',
          '```',
        ].join('\n'),
      }),
    )

    expect(html).toContain('<h2')
    expect(html).toContain('<ul')
    expect(html).toContain('<strong')
    expect(html).toContain('<code')
    expect(html).toContain('const ok = true')
  })

  it('escapes raw html and strips unsafe links', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: '[bad](javascript:alert(1)) <script>alert(1)</script>',
      }),
    )

    expect(html).not.toContain('href="javascript:alert(1)"')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders quotes and apostrophes from source text, not raw html entities', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: `say "hi" — don't forget \`echo "ok"\``,
      }),
    )

    expect(html).not.toContain('&amp;quot;')
    expect(html).not.toContain('&amp;#39;')
    expect(html).toContain('say &quot;hi&quot;')
    expect(html).toContain('don&#x27;t')
    expect(html).toContain('echo &quot;ok&quot;')
  })
})
