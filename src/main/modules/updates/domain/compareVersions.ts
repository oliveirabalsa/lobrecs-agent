export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(normalizeVersion(candidate), normalizeVersion(current)) > 0
}

function compareSemver(a: string, b: string): number {
  const [aCore, aPre] = splitPrerelease(a)
  const [bCore, bPre] = splitPrerelease(b)

  const aParts = aCore.split('.').map(toInt)
  const bParts = bCore.split('.').map(toInt)
  const length = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }

  if (aPre && !bPre) return -1
  if (!aPre && bPre) return 1
  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? 1 : 0
  return 0
}

function splitPrerelease(version: string): [string, string | undefined] {
  const idx = version.indexOf('-')
  if (idx === -1) return [version, undefined]
  return [version.slice(0, idx), version.slice(idx + 1)]
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}
