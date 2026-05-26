import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  PrimarySpecArtifactKind,
  Spec,
  SpecArtifact,
  SpecArtifactFrontmatter,
  SpecArtifactFrontmatterValue,
  SpecArtifactKind,
  WriteSpecArtifactInput,
} from '../../../../shared/types'
import { PRIMARY_SPEC_ARTIFACT_KINDS } from '../../../../shared/types'

const WORKFLOWS_DIR = '.lobrecs/workflows'
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024

const PRIMARY_ARTIFACT_FILES: Record<PrimarySpecArtifactKind, string> = {
  prd: 'prd.md',
  techspec: 'techspec.md',
  tasks: 'tasks.md',
  memory: 'memory.md',
}

const ARTIFACT_TITLES: Record<SpecArtifactKind, string> = {
  prd: 'PRD',
  techspec: 'Tech Spec',
  tasks: 'Tasks',
  review: 'Review',
  memory: 'Memory',
}

export class SpecArtifactService {
  async listArtifacts(spec: Spec, repoPath: string): Promise<SpecArtifact[]> {
    const workflowDir = await this.resolveWorkflowDir(spec, repoPath)
    await mkdir(workflowDir, { recursive: true })

    const primaryArtifacts = await Promise.all(
      PRIMARY_SPEC_ARTIFACT_KINDS.map((kind) =>
        this.ensureAndReadArtifact(spec, repoPath, workflowDir, kind, PRIMARY_ARTIFACT_FILES[kind]),
      ),
    )
    const reviewArtifacts = await this.listReviewArtifacts(spec, repoPath, workflowDir)

    return [...primaryArtifacts, ...reviewArtifacts]
  }

  async readArtifact(spec: Spec, repoPath: string, artifactId: string): Promise<SpecArtifact> {
    const workflowDir = await this.resolveWorkflowDir(spec, repoPath)
    const target = await this.resolveArtifactTarget(spec, repoPath, workflowDir, artifactId)
    return this.readExistingArtifact(spec, repoPath, target.kind, target.filePath)
  }

  async writeArtifact(
    spec: Spec,
    repoPath: string,
    input: WriteSpecArtifactInput,
  ): Promise<SpecArtifact> {
    const workflowDir = await this.resolveWorkflowDir(spec, repoPath)
    await mkdir(workflowDir, { recursive: true })

    const target = input.artifactId
      ? await this.resolveArtifactTarget(spec, repoPath, workflowDir, input.artifactId)
      : await this.createArtifactTarget(workflowDir, input.kind, input.title)

    if (target.kind !== input.kind) {
      throw new Error('Artifact kind does not match the selected artifact.')
    }

    const title = normalizedTitle(input.title) ?? ARTIFACT_TITLES[input.kind]
    const existing = await this.readExistingArtifactIfPresent(spec, repoPath, input.kind, target.filePath)
    const version = existing ? existing.version + 1 : 1
    const frontmatter: SpecArtifactFrontmatter = {
      ...(existing?.frontmatter ?? {}),
      specId: spec.id,
      kind: input.kind,
      version,
      title,
    }

    await mkdir(path.dirname(target.filePath), { recursive: true })
    await writeFile(target.filePath, serializeArtifact(frontmatter, input.markdown), 'utf8')

    return this.readExistingArtifact(spec, repoPath, input.kind, target.filePath)
  }

  private async ensureAndReadArtifact(
    spec: Spec,
    repoPath: string,
    workflowDir: string,
    kind: PrimarySpecArtifactKind,
    fileName: string,
  ): Promise<SpecArtifact> {
    const filePath = path.join(workflowDir, fileName)
    const existing = await this.readExistingArtifactIfPresent(spec, repoPath, kind, filePath)
    if (existing) return existing

    await writeFile(
      filePath,
      serializeArtifact(defaultFrontmatter(spec, kind), defaultMarkdown(spec, kind)),
      'utf8',
    )
    return this.readExistingArtifact(spec, repoPath, kind, filePath)
  }

  private async listReviewArtifacts(
    spec: Spec,
    repoPath: string,
    workflowDir: string,
  ): Promise<SpecArtifact[]> {
    const reviewsDir = path.join(workflowDir, 'reviews')
    const entries = await readdir(reviewsDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })

    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(reviewsDir, entry.name))
      .sort((a, b) => a.localeCompare(b))

    return Promise.all(
      files.map((filePath) => this.readExistingArtifact(spec, repoPath, 'review', filePath)),
    )
  }

  private async resolveWorkflowDir(spec: Spec, repoPath: string): Promise<string> {
    const workflowsRoot = insideRepo(repoPath, WORKFLOWS_DIR)
    await mkdir(workflowsRoot, { recursive: true })

    const existing = await findWorkflowDirForSpec(workflowsRoot, spec.id)
    if (existing) return existing

    return insideRepo(repoPath, path.join(WORKFLOWS_DIR, workflowSlug(spec)))
  }

  private async resolveArtifactTarget(
    spec: Spec,
    repoPath: string,
    workflowDir: string,
    artifactId: string,
  ): Promise<{ kind: SpecArtifactKind; filePath: string }> {
    const primaryKind = PRIMARY_SPEC_ARTIFACT_KINDS.find((kind) => kind === artifactId)
    if (primaryKind) {
      return {
        kind: primaryKind,
        filePath: insideRepo(repoPath, path.relative(repoPath, path.join(workflowDir, PRIMARY_ARTIFACT_FILES[primaryKind]))),
      }
    }

    if (!artifactId.startsWith('review:')) {
      throw new Error(`Unknown workflow artifact: ${artifactId}`)
    }

    const slug = artifactId.slice('review:'.length)
    if (!isSafeSlug(slug)) {
      throw new Error('Review artifact id is invalid.')
    }

    return {
      kind: 'review',
      filePath: insideRepo(repoPath, path.join(path.relative(repoPath, workflowDir), 'reviews', `${slug}.md`)),
    }
  }

  private async createArtifactTarget(
    workflowDir: string,
    kind: SpecArtifactKind,
    title?: string,
  ): Promise<{ kind: SpecArtifactKind; filePath: string }> {
    if (kind !== 'review') {
      return { kind, filePath: path.join(workflowDir, PRIMARY_ARTIFACT_FILES[kind]) }
    }

    const reviewsDir = path.join(workflowDir, 'reviews')
    await mkdir(reviewsDir, { recursive: true })
    const baseSlug = slugify(normalizedTitle(title) ?? 'review')
    let candidate = path.join(reviewsDir, `${baseSlug}.md`)
    let suffix = 2
    while (await fileExists(candidate)) {
      candidate = path.join(reviewsDir, `${baseSlug}-${suffix}.md`)
      suffix += 1
    }

    return { kind, filePath: candidate }
  }

  private async readExistingArtifactIfPresent(
    spec: Spec,
    repoPath: string,
    kind: SpecArtifactKind,
    filePath: string,
  ): Promise<SpecArtifact | null> {
    if (!(await fileExists(filePath))) return null
    return this.readExistingArtifact(spec, repoPath, kind, filePath)
  }

  private async readExistingArtifact(
    spec: Spec,
    repoPath: string,
    kind: SpecArtifactKind,
    filePath: string,
  ): Promise<SpecArtifact> {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('Workflow artifact target is not a file.')
    if (info.size > MAX_ARTIFACT_BYTES) throw new Error('Workflow artifact is too large.')

    const content = await readFile(filePath, 'utf8')
    const parsed = parseArtifact(content)
    validateArtifactFrontmatter(parsed.frontmatter, spec.id, kind, path.relative(repoPath, filePath))

    const relativePath = path.relative(repoPath, filePath)
    return {
      id: artifactId(kind, filePath),
      specId: spec.id,
      kind,
      version: Number(parsed.frontmatter.version),
      title: String(parsed.frontmatter.title ?? ARTIFACT_TITLES[kind]),
      filePath,
      relativePath,
      frontmatter: parsed.frontmatter,
      markdown: parsed.markdown,
      updatedAt: info.mtimeMs,
    }
  }
}

export const specArtifactService = new SpecArtifactService()

function defaultFrontmatter(spec: Spec, kind: SpecArtifactKind): SpecArtifactFrontmatter {
  return {
    specId: spec.id,
    kind,
    version: 1,
    title: ARTIFACT_TITLES[kind],
  }
}

function defaultMarkdown(spec: Spec, kind: PrimarySpecArtifactKind): string {
  switch (kind) {
    case 'prd':
      return [
        `# PRD: ${spec.title}`,
        '',
        '## Goal',
        spec.goal || 'Define the product goal here.',
        '',
        '## Context',
        spec.context || 'Add relevant background and constraints.',
        '',
        '## Acceptance Criteria',
        ...spec.acceptanceCriteria.map((criterion) => `- [ ] ${criterion.body}`),
      ].join('\n')
    case 'techspec':
      return [
        `# Tech Spec: ${spec.title}`,
        '',
        '## Approach',
        'Describe the implementation approach, module boundaries, and data flow.',
        '',
        '## Target Files',
        ...spec.targetFiles.map((filePath) => `- ${filePath}`),
        '',
        '## Risks',
        '- Document technical risks before execution.',
      ].join('\n')
    case 'tasks':
      return [
        `# Tasks: ${spec.title}`,
        '',
        ...spec.requirements.map((requirement) => `- [ ] ${requirement.body}`),
      ].join('\n')
    case 'memory':
      return [
        `# Memory: ${spec.title}`,
        '',
        '- Add durable workflow findings, decisions, and follow-up context here.',
      ].join('\n')
  }
}

function serializeArtifact(frontmatter: SpecArtifactFrontmatter, markdown: string): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${serializeScalar(value)}`)
  return ['---', ...lines, '---', markdown.trimStart()].join('\n')
}

function parseArtifact(content: string): {
  frontmatter: SpecArtifactFrontmatter
  markdown: string
} {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    throw new Error('Workflow artifact is missing frontmatter.')
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex === -1) {
    throw new Error('Workflow artifact frontmatter is not closed.')
  }

  const frontmatter = parseFrontmatterLines(lines.slice(1, endIndex))
  const markdown = lines.slice(endIndex + 1).join('\n')
  return { frontmatter, markdown }
}

function parseFrontmatterLines(lines: string[]): SpecArtifactFrontmatter {
  const frontmatter: SpecArtifactFrontmatter = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      throw new Error('Workflow artifact frontmatter contains an invalid entry.')
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) {
      throw new Error('Workflow artifact frontmatter contains an invalid key.')
    }

    frontmatter[key] = parseScalar(trimmed.slice(separatorIndex + 1).trim())
  }

  return frontmatter
}

function validateArtifactFrontmatter(
  frontmatter: SpecArtifactFrontmatter,
  specId: string,
  kind: SpecArtifactKind,
  relativePath: string,
): void {
  if (frontmatter.specId !== specId) {
    throw new Error(`Workflow artifact ${relativePath} belongs to another spec.`)
  }
  if (frontmatter.kind !== kind) {
    throw new Error(`Workflow artifact ${relativePath} has the wrong kind.`)
  }
  if (
    typeof frontmatter.version !== 'number' ||
    !Number.isInteger(frontmatter.version) ||
    frontmatter.version < 1
  ) {
    throw new Error(`Workflow artifact ${relativePath} has an invalid version.`)
  }
  if (frontmatter.title !== undefined && typeof frontmatter.title !== 'string') {
    throw new Error(`Workflow artifact ${relativePath} has an invalid title.`)
  }
}

function parseScalar(value: string): SpecArtifactFrontmatterValue {
  if (!value) return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function serializeScalar(value: SpecArtifactFrontmatterValue): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  return String(value)
}

async function findWorkflowDirForSpec(workflowsRoot: string, specId: string): Promise<string | null> {
  const entries = await readdir(workflowsRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(workflowsRoot, entry.name, 'prd.md')
    try {
      const parsed = parseArtifact(await readFile(candidate, 'utf8'))
      if (parsed.frontmatter.specId === specId) return path.join(workflowsRoot, entry.name)
    } catch {
      // Malformed candidates are validated when the selected workflow is read.
    }
  }

  return null
}

function artifactId(kind: SpecArtifactKind, filePath: string): string {
  if (kind !== 'review') return kind
  return `review:${path.basename(filePath, '.md')}`
}

function workflowSlug(spec: Spec): string {
  return `${slugify(spec.title)}-${spec.id.slice(0, 8)}`
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'workflow'
}

function isSafeSlug(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && !value.includes('..')
}

function normalizedTitle(value?: string): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function insideRepo(repoPath: string, relativePath: string): string {
  const root = path.resolve(repoPath)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Workflow artifacts must stay inside the selected project.')
  }
  return resolved
}
