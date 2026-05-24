import path from 'node:path'

const REDACTION = '[REDACTED_SECRET]'

const SECRET_ASSIGNMENT =
  /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|database[_-]?url|db[_-]?password|password|private[_-]?key|refresh[_-]?token|secret|token)\b\s*[:=]\s*)(['"]?)([^\s'",}]{8,})(\2)/gi

const SECRET_PATTERNS: RegExp[] = [
  SECRET_ASSIGNMENT,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

const SENSITIVE_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
])

const SENSITIVE_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx'])

export function redactSensitiveText(text: string): string {
  let redacted = text

  redacted = redacted.replace(
    SECRET_ASSIGNMENT,
    (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTION}${quote}`,
  )

  for (const pattern of SECRET_PATTERNS.slice(1)) {
    redacted = redacted.replace(pattern, REDACTION)
  }

  return redacted
}

export function isSensitiveRepositoryPath(filePath: string): boolean {
  const basename = path.basename(filePath)
  if (SENSITIVE_FILENAMES.has(basename)) return true
  if (basename.startsWith('.env.')) return true
  return SENSITIVE_EXTENSIONS.has(path.extname(basename))
}
