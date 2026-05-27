import { Fragment, useState, type ReactNode } from 'react'
import { lexer, type Token, type Tokens } from 'marked'

export interface MarkdownContentProps {
  text: string
  className?: string
  variant?: 'assistant' | 'compact'
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
}

export interface MarkdownLinkRequest {
  href: string
  title?: string
  label?: string
}

interface MarkdownRenderContext {
  onOpenMarkdown?: (request: MarkdownLinkRequest) => void
}

const MARKDOWN_OPTIONS = {
  breaks: true,
  gfm: true,
}

export function MarkdownContent({
  text,
  className,
  variant = 'assistant',
  onOpenMarkdown,
}: MarkdownContentProps) {
  const tokens = lexer(text, MARKDOWN_OPTIONS)
  const context: MarkdownRenderContext = { onOpenMarkdown }

  return (
    <div className={cx(containerClass(variant), className)}>
      {tokens.map((token, index) => renderBlockToken(token, `${index}`, context))}
    </div>
  )
}

function renderBlockToken(
  token: Token,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'heading':
      return renderHeading(token as Tokens.Heading, key, context)
    case 'paragraph':
      return (
        <p key={key} className="min-w-0">
          {renderInlineTokens((token as Tokens.Paragraph).tokens ?? [], key, context)}
        </p>
      )
    case 'text': {
      const textToken = token as Tokens.Text | Tokens.Tag
      return (
        <p key={key} className="min-w-0">
          {'tokens' in textToken && textToken.tokens
            ? renderInlineTokens(textToken.tokens, key, context)
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
              renderBlockToken(child, `${key}-quote-${index}`, context),
            )}
          </div>
        </blockquote>
      )
    }
    case 'list':
      return renderList(token as Tokens.List, key, context)
    case 'hr':
      return <hr key={key} className="border-hairline" />
    case 'table':
      return renderTable(token as Tokens.Table, key, context)
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

function renderHeading(
  token: Tokens.Heading,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  const level = Math.min(Math.max(token.depth, 1), 6)
  const className = cx(
    'min-w-0 font-semibold text-primary',
    level === 1 && 'text-xl leading-7',
    level === 2 && 'text-lg leading-7',
    level === 3 && 'text-base leading-6',
    level >= 4 && 'text-sm leading-6',
  )
  const children = renderInlineTokens(token.tokens, key, context)

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
  return <CodeBlock key={key} text={token.text} language={language} />
}

interface CodeBlockProps {
  text: string
  language?: string
}

function CodeBlock({ text, language }: CodeBlockProps) {
  return (
    <figure className="my-2 overflow-hidden rounded-card border border-hairline bg-[#0a0a0c]/90 shadow-elevated">
      <div className="flex items-center justify-between border-b border-hairline bg-card-raised/30 px-3 py-1.5">
        {language ? (
          <span className="font-mono text-[10px] font-medium text-muted tracking-wider">
            {language}
          </span>
        ) : (
          <span />
        )}
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto p-3 text-[11.5px] leading-[1.4] text-secondary">
        <code className="font-mono select-text whitespace-pre">{text}</code>
      </pre>
    </figure>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-[10.5px] text-muted hover:text-primary transition-colors focus:outline-none cursor-pointer"
      aria-label={copied ? 'Copied code' : 'Copy code'}
    >
      {copied ? (
        <>
          {iconCheck}
          <span>Copied</span>
        </>
      ) : (
        <>
          {iconCopy}
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

const iconCopy = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M11 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1" />
  </svg>
)

const iconCheck = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.25 4.75L6 12L2.75 8.75" />
  </svg>
)

function renderList(
  token: Tokens.List,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
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
        {renderListItems(token, key, context)}
      </ol>
    )
  }

  return (
    <ul key={key} className={className}>
      {renderListItems(token, key, context)}
    </ul>
  )
}

function renderListItems(
  token: Tokens.List,
  key: string,
  context: MarkdownRenderContext,
): ReactNode[] {
  return token.items.map((item, index) => (
    <li key={`${key}-item-${index}`} className="pl-1">
      {renderListItem(item, `${key}-item-${index}`, context)}
    </li>
  ))
}

function renderListItem(
  item: Tokens.ListItem,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  const content = renderListItemContent(item, key, context)
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

function renderListItemContent(
  item: Tokens.ListItem,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  if (item.tokens.length === 1) {
    const [only] = item.tokens
    if (only.type === 'text') {
      const textToken = only as Tokens.Text | Tokens.Tag
      return 'tokens' in textToken && textToken.tokens
        ? renderInlineTokens(textToken.tokens, key, context)
        : decodeEntities(textToken.text)
    }
    if (only.type === 'paragraph') {
      return renderInlineTokens((only as Tokens.Paragraph).tokens ?? [], key, context)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {item.tokens.map((token, index) =>
        renderBlockToken(token, `${key}-block-${index}`, context),
      )}
    </div>
  )
}

function renderTable(
  token: Tokens.Table,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  return (
    <div key={key} className="overflow-x-auto rounded-card border border-hairline">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-card-raised text-secondary">
          <tr>
            {token.header.map((cell, index) => (
              <th key={`${key}-head-${index}`} className={tableCellClass(cell.align, true)}>
                {renderInlineTokens(cell.tokens, `${key}-head-${index}`, context)}
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
                  {renderInlineTokens(cell.tokens, `${key}-cell-${rowIndex}-${cellIndex}`, context)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderInlineTokens(
  tokens: Token[],
  keyPrefix: string,
  context: MarkdownRenderContext,
): ReactNode[] {
  return tokens.map((token, index) =>
    renderInlineToken(token, `${keyPrefix}-inline-${index}`, context),
  )
}

function renderInlineToken(
  token: Token,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  switch (token.type) {
    case 'text':
    case 'escape':
      return <Fragment key={key}>{decodeEntities(token.text)}</Fragment>
    case 'strong':
      return (
        <strong key={key} className="font-semibold text-primary">
          {renderInlineTokens((token as Tokens.Strong).tokens ?? [], key, context)}
        </strong>
      )
    case 'em':
      return <em key={key}>{renderInlineTokens((token as Tokens.Em).tokens ?? [], key, context)}</em>
    case 'del':
      return (
        <del key={key} className="text-muted">
          {renderInlineTokens((token as Tokens.Del).tokens ?? [], key, context)}
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
      return renderLink(token as Tokens.Link, key, context)
    case 'image':
      return renderImageFallback(token as Tokens.Image, key)
    case 'html':
      return <Fragment key={key}>{token.raw}</Fragment>
    default:
      return null
  }
}

function renderLink(
  token: Tokens.Link,
  key: string,
  context: MarkdownRenderContext,
): ReactNode {
  const children = renderInlineTokens(token.tokens, key, context)
  if (!isSafeHref(token.href)) {
    return <span key={key}>{children}</span>
  }

  if (context.onOpenMarkdown && isPreviewableMarkdownHref(token.href)) {
    const label = inlinePlainText(token.tokens)
    return (
      <a
        key={key}
        href={normalizeHref(token.href)}
        title={token.title ?? undefined}
        data-markdown-preview="true"
        onClick={(event) => {
          event.preventDefault()
          context.onOpenMarkdown?.({
            href: token.href,
            title: token.title ?? undefined,
            label,
          })
        }}
        className="text-accent-primary underline decoration-accent-primary/40 underline-offset-2 hover:decoration-accent-primary"
      >
        {children}
      </a>
    )
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
  if (isPreviewableMarkdownHref(trimmed)) return true

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

export function isPreviewableMarkdownHref(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return false

  try {
    const parsed = new URL(trimmed)
    return ['http:', 'https:', 'file:'].includes(parsed.protocol) &&
      hasMarkdownExtension(parsed.pathname)
  } catch {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false
    return hasMarkdownExtension(stripQueryAndHash(trimmed))
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

function hasMarkdownExtension(pathname: string): boolean {
  const lower = pathname.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown')
}

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value
}

function inlinePlainText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if ('text' in token && typeof token.text === 'string') return decodeEntities(token.text)
      if ('tokens' in token && Array.isArray(token.tokens)) return inlinePlainText(token.tokens)
      return ''
    })
    .join('')
    .trim()
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
