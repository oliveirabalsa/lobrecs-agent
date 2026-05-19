import { Fragment, type ReactNode } from 'react'
import { lexer, type Token, type Tokens } from 'marked'

export interface MarkdownContentProps {
  text: string
  className?: string
  variant?: 'assistant' | 'compact'
}

const MARKDOWN_OPTIONS = {
  breaks: true,
  gfm: true,
}

export function MarkdownContent({
  text,
  className,
  variant = 'assistant',
}: MarkdownContentProps) {
  const tokens = lexer(text, MARKDOWN_OPTIONS)

  return (
    <div className={cx(containerClass(variant), className)}>
      {tokens.map((token, index) => renderBlockToken(token, `${index}`))}
    </div>
  )
}

function renderBlockToken(token: Token, key: string): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'heading':
      return renderHeading(token as Tokens.Heading, key)
    case 'paragraph':
      return (
        <p key={key} className="min-w-0">
          {renderInlineTokens((token as Tokens.Paragraph).tokens ?? [], key)}
        </p>
      )
    case 'text': {
      const textToken = token as Tokens.Text | Tokens.Tag
      return (
        <p key={key} className="min-w-0">
          {'tokens' in textToken && textToken.tokens
            ? renderInlineTokens(textToken.tokens, key)
            : decodeEntities(textToken.text)}
        </p>
      )
    }
    case 'code':
      return renderCodeBlock(token as Tokens.Code, key)
    case 'blockquote': {
      const blockquote = token as Tokens.Blockquote
      return (
        <blockquote key={key} className="border-l-2 border-hairline pl-3 text-secondary">
          <div className="flex flex-col gap-2">
            {blockquote.tokens.map((child, index) =>
              renderBlockToken(child, `${key}-quote-${index}`),
            )}
          </div>
        </blockquote>
      )
    }
    case 'list':
      return renderList(token as Tokens.List, key)
    case 'hr':
      return <hr key={key} className="border-hairline" />
    case 'table':
      return renderTable(token as Tokens.Table, key)
    case 'html':
      return (
        <p key={key} className="whitespace-pre-wrap font-mono text-xs text-secondary">
          {token.raw}
        </p>
      )
    default:
      return null
  }
}

function renderHeading(token: Tokens.Heading, key: string): ReactNode {
  const level = Math.min(Math.max(token.depth, 1), 6)
  const className = cx(
    'min-w-0 font-semibold text-primary',
    level === 1 && 'text-xl leading-7',
    level === 2 && 'text-lg leading-7',
    level === 3 && 'text-base leading-6',
    level >= 4 && 'text-sm leading-6',
  )
  const children = renderInlineTokens(token.tokens, key)

  switch (level) {
    case 1:
      return <h1 key={key} className={className}>{children}</h1>
    case 2:
      return <h2 key={key} className={className}>{children}</h2>
    case 3:
      return <h3 key={key} className={className}>{children}</h3>
    case 4:
      return <h4 key={key} className={className}>{children}</h4>
    case 5:
      return <h5 key={key} className={className}>{children}</h5>
    default:
      return <h6 key={key} className={className}>{children}</h6>
  }
}

function renderCodeBlock(token: Tokens.Code, key: string): ReactNode {
  const language = token.lang?.trim()

  return (
    <figure key={key} className="overflow-hidden rounded-card border border-hairline bg-card">
      {language ? (
        <figcaption className="border-b border-hairline px-3 py-1 text-[11px] text-muted">
          {language}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto px-3 py-2 text-[12px] leading-5 text-secondary">
        <code className="font-mono">{token.text}</code>
      </pre>
    </figure>
  )
}

function renderList(token: Tokens.List, key: string): ReactNode {
  const className = cx(
    'flex flex-col gap-1 pl-5',
    token.ordered ? 'list-decimal' : 'list-disc',
  )

  if (token.ordered) {
    return (
      <ol
        key={key}
        start={typeof token.start === 'number' ? token.start : undefined}
        className={className}
      >
        {renderListItems(token, key)}
      </ol>
    )
  }

  return (
    <ul key={key} className={className}>
      {renderListItems(token, key)}
    </ul>
  )
}

function renderListItems(token: Tokens.List, key: string): ReactNode[] {
  return token.items.map((item, index) => (
    <li key={`${key}-item-${index}`} className="pl-1">
      {renderListItem(item, `${key}-item-${index}`)}
    </li>
  ))
}

function renderListItem(item: Tokens.ListItem, key: string): ReactNode {
  const content = renderListItemContent(item, key)
  if (!item.task) return content

  return (
    <span className="flex min-w-0 items-start gap-2">
      <input
        type="checkbox"
        checked={item.checked ?? false}
        readOnly
        tabIndex={-1}
        className="mt-[0.35rem] h-3.5 w-3.5 shrink-0 accent-accent-primary"
        aria-label={item.checked ? 'Completed task' : 'Open task'}
      />
      <span className="min-w-0 flex-1">{content}</span>
    </span>
  )
}

function renderListItemContent(item: Tokens.ListItem, key: string): ReactNode {
  if (item.tokens.length === 1) {
    const [only] = item.tokens
    if (only.type === 'text') {
      const textToken = only as Tokens.Text | Tokens.Tag
      return 'tokens' in textToken && textToken.tokens
        ? renderInlineTokens(textToken.tokens, key)
        : decodeEntities(textToken.text)
    }
    if (only.type === 'paragraph') {
      return renderInlineTokens((only as Tokens.Paragraph).tokens ?? [], key)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {item.tokens.map((token, index) =>
        renderBlockToken(token, `${key}-block-${index}`),
      )}
    </div>
  )
}

function renderTable(token: Tokens.Table, key: string): ReactNode {
  return (
    <div key={key} className="overflow-x-auto rounded-card border border-hairline">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-card-raised text-secondary">
          <tr>
            {token.header.map((cell, index) => (
              <th key={`${key}-head-${index}`} className={tableCellClass(cell.align, true)}>
                {renderInlineTokens(cell.tokens, `${key}-head-${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {token.rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`} className="border-t border-hairline">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${key}-cell-${rowIndex}-${cellIndex}`}
                  className={tableCellClass(cell.align, false)}
                >
                  {renderInlineTokens(cell.tokens, `${key}-cell-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderInlineTokens(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) =>
    renderInlineToken(token, `${keyPrefix}-inline-${index}`),
  )
}

function renderInlineToken(token: Token, key: string): ReactNode {
  switch (token.type) {
    case 'text':
    case 'escape':
      return <Fragment key={key}>{decodeEntities(token.text)}</Fragment>
    case 'strong':
      return (
        <strong key={key} className="font-semibold text-primary">
          {renderInlineTokens((token as Tokens.Strong).tokens ?? [], key)}
        </strong>
      )
    case 'em':
      return <em key={key}>{renderInlineTokens((token as Tokens.Em).tokens ?? [], key)}</em>
    case 'del':
      return (
        <del key={key} className="text-muted">
          {renderInlineTokens((token as Tokens.Del).tokens ?? [], key)}
        </del>
      )
    case 'codespan':
      return (
        <code
          key={key}
          className="rounded border border-hairline bg-card-raised px-1 py-0.5 font-mono text-[0.92em] text-primary"
        >
          {decodeEntities(token.text)}
        </code>
      )
    case 'br':
      return <br key={key} />
    case 'link':
      return renderLink(token as Tokens.Link, key)
    case 'image':
      return renderImageFallback(token as Tokens.Image, key)
    case 'html':
      return <Fragment key={key}>{token.raw}</Fragment>
    default:
      return null
  }
}

function renderLink(token: Tokens.Link, key: string): ReactNode {
  const children = renderInlineTokens(token.tokens, key)
  if (!isSafeHref(token.href)) {
    return <span key={key}>{children}</span>
  }

  return (
    <a
      key={key}
      href={normalizeHref(token.href)}
      title={token.title ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="text-accent-primary underline decoration-accent-primary/40 underline-offset-2 hover:decoration-accent-primary"
    >
      {children}
    </a>
  )
}

function renderImageFallback(token: Tokens.Image, key: string): ReactNode {
  const label = token.text.trim() || token.href

  return (
      <span key={key} className="text-secondary">
      image:{' '}
      {isSafeHref(token.href) ? (
        <a
          href={normalizeHref(token.href)}
          title={token.title ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="text-accent-primary underline decoration-accent-primary/40 underline-offset-2 hover:decoration-accent-primary"
        >
          {label}
        </a>
      ) : (
        label
      )}
    </span>
  )
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return true

  if (trimmed.startsWith('/')) return true
  if (/^[a-zA-Z]:\\/.test(trimmed)) return true
  if (trimmed.startsWith('file://')) return true

  try {
    const parsed = new URL(trimmed)
    return ['http:', 'https:', 'mailto:', 'file:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function normalizeHref(href: string): string {
  const trimmed = href.trim()

  if (trimmed.startsWith('file://')) {
    return trimmed
  }

  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`
  }

  if (/^[a-zA-Z]:\\/.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, '/')}`
  }

  return trimmed
}

function tableCellClass(align: Tokens.TableCell['align'], header: boolean): string {
  return cx(
    'border-r border-hairline px-3 py-2 last:border-r-0',
    header ? 'font-semibold text-primary' : 'text-secondary',
    align === 'center' && 'text-center',
    align === 'right' && 'text-right',
  )
}

function containerClass(variant: MarkdownContentProps['variant']): string {
  return cx(
    'min-w-0 text-sm leading-6 text-primary',
    variant === 'assistant' ? 'flex flex-col gap-3' : 'flex flex-col gap-2',
  )
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// marked's lexer pre-escapes inline text for direct HTML interpolation, so
// `"hi"` lands in tokens as `&quot;hi&quot;`. We render through React/JSX
// instead, which already escapes on output, so we need to undo the lexer's
// escape pass before render — otherwise readers see literal `&quot;`.
function decodeEntities(text: string): string {
  if (!text || text.indexOf('&') === -1) return text
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return ENTITY_MAP[body.toLowerCase()] ?? match
  })
}
