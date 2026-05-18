export interface CompletionFooterProps {
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  durationMs?: number
}

/**
 * Muted one-line summary that appears at the end of a completed turn.
 * Example: `12k in · 3.2k out · $0.018 · 2m 56s`. Hidden when no values.
 */
export function CompletionFooter({
  tokensIn,
  tokensOut,
  costUsd,
  durationMs,
}: CompletionFooterProps) {
  const parts: string[] = []
  if (typeof tokensIn === 'number') parts.push(`${formatTokens(tokensIn)} in`)
  if (typeof tokensOut === 'number') parts.push(`${formatTokens(tokensOut)} out`)
  if (typeof costUsd === 'number') parts.push(formatCost(costUsd))
  if (typeof durationMs === 'number' && durationMs > 0) parts.push(formatDuration(durationMs))

  if (parts.length === 0) return null

  return (
    <div className="mt-2 text-center text-xs text-muted">
      {parts.join(' · ')}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${trimFloat(v)}M`
  }
  if (n >= 1_000) {
    const v = n / 1_000
    return `${trimFloat(v)}k`
  }
  return String(Math.round(n))
}

function trimFloat(n: number): string {
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '')
  return n.toFixed(1).replace(/\.0$/, '')
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}
