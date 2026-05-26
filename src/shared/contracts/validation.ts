export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

export function assertString(
  value: unknown,
  label: string,
  options: { maxLength?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }

  const trimmed = value.trim()
  if (!options.allowEmpty && !trimmed) {
    throw new Error(`${label} is required.`)
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`${label} is too long.`)
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} contains unsupported control characters.`)
  }

  return value
}

export function optionalString(
  value: unknown,
  label: string,
  options: { maxLength?: number; allowEmpty?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null) return undefined
  return assertString(value, label, options)
}

export function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}

export function optionalInteger(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`)
  }
  const integerValue = value
  if (options.min !== undefined && integerValue < options.min) {
    throw new Error(`${label} is too small.`)
  }
  if (options.max !== undefined && integerValue > options.max) {
    throw new Error(`${label} is too large.`)
  }
  return integerValue
}

export function assertOneOf<const T extends readonly string[]>(
  value: unknown,
  label: string,
  allowed: T,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

export function optionalOneOf<const T extends readonly string[]>(
  value: unknown,
  label: string,
  allowed: T,
): T[number] | undefined {
  if (value === undefined || value === null) return undefined
  return assertOneOf(value, label, allowed)
}

export function assertPlainId(value: unknown, label: string): string {
  const id = assertString(value, label, { maxLength: 200 })
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) {
    throw new Error(`${label} contains unsupported characters.`)
  }
  return id
}

export function assertAbsolutePath(value: unknown, label: string): string {
  const pathValue = assertString(value, label, { maxLength: 4096 })
  if (!pathValue.startsWith('/')) {
    throw new Error(`${label} must be an absolute path.`)
  }
  return pathValue
}

export function assertNoShellBreaks(command: string, label: string): string {
  if (/[\r\n]/.test(command)) {
    throw new Error(`${label} must be a single command.`)
  }
  return command
}
