const VECTOR_SIZE = 256

export type TextEmbedding = number[]

export function embedText(value: string): TextEmbedding {
  const vector = Array.from({ length: VECTOR_SIZE }, () => 0)
  const tokens = tokenize(value)

  for (const token of tokens) {
    vector[hashToken(token) % VECTOR_SIZE] += tokenWeight(token)
  }

  normalize(vector)
  return vector
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length)
  let score = 0

  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index]
  }

  return score
}

export function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
}

function normalize(vector: number[]): void {
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
  if (magnitude === 0) return

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = vector[index] / magnitude
  }
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function tokenWeight(token: string): number {
  if (/^[0-9]+$/.test(token)) return 0.5
  if (token.length > 16) return 1.4
  if (token.length > 8) return 1.2
  return 1
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'into',
  'you',
  'your',
  'are',
  'was',
  'were',
  'has',
  'have',
  'not',
  'but',
  'use',
  'using',
  'will',
  'can',
  'all',
])
