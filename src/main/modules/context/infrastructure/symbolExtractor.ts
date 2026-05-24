import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  Project,
  SyntaxKind,
  ts,
  type ClassDeclaration,
  type ConstructorDeclaration,
  type EnumDeclaration,
  type FunctionDeclaration,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type MethodSignature,
  type PropertyDeclaration,
  type SourceFile,
  type TypeAliasDeclaration,
  type VariableStatement,
} from 'ts-morph'

const MAX_SYMBOL_FILES = 1_000
const MAX_SYMBOL_FILE_BYTES = 220 * 1024
const MAX_SYMBOLS = 320
const MAX_SYMBOL_MAP_CHARS = 7_500

const SYMBOL_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'tmp',
])

interface SymbolSourceFile {
  absolutePath: string
  relativePath: string
}

interface FileSymbols {
  path: string
  symbols: string[]
}

export async function extractRepositorySymbolManifest(repoPath: string): Promise<string | null> {
  const root = path.resolve(repoPath)
  const files = await collectSymbolFiles(root)
  if (files.length === 0) return null

  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
    },
  })

  const fileSymbols: FileSymbols[] = []
  let totalSymbols = 0

  for (const file of files) {
    if (totalSymbols >= MAX_SYMBOLS) break

    const sourceFile = addSourceFile(project, file.absolutePath)
    if (!sourceFile) continue

    const symbols = extractFileSymbols(sourceFile).slice(0, MAX_SYMBOLS - totalSymbols)
    if (symbols.length === 0) continue

    fileSymbols.push({ path: file.relativePath, symbols })
    totalSymbols += symbols.length
  }

  if (fileSymbols.length === 0) return null

  const manifest = [
    'Repository symbol map (repo-wide; use before guessing filenames or APIs):',
    ...fileSymbols.flatMap((file) => [
      `- ${file.path}`,
      ...file.symbols.map((symbol) => `  - ${symbol}`),
    ]),
  ].join('\n')

  if (manifest.length <= MAX_SYMBOL_MAP_CHARS) return manifest

  return `${manifest.slice(0, MAX_SYMBOL_MAP_CHARS).trimEnd()}\n[symbol map truncated]`
}

async function collectSymbolFiles(root: string): Promise<SymbolSourceFile[]> {
  const files: SymbolSourceFile[] = []

  async function visit(directory: string): Promise<void> {
    if (files.length >= MAX_SYMBOL_FILES) return

    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (files.length >= MAX_SYMBOL_FILES) break

      const absolutePath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue
        await visit(absolutePath)
        continue
      }

      if (!entry.isFile() || !SYMBOL_EXTENSIONS.has(path.extname(entry.name))) continue

      try {
        const stat = await fs.stat(absolutePath)
        if (stat.size <= 0 || stat.size > MAX_SYMBOL_FILE_BYTES) continue

        files.push({
          absolutePath,
          relativePath: normalizePath(path.relative(root, absolutePath)),
        })
      } catch {
        continue
      }
    }
  }

  await visit(root)
  return files
}

function addSourceFile(project: Project, absolutePath: string): SourceFile | null {
  try {
    return project.addSourceFileAtPath(absolutePath)
  } catch {
    return null
  }
}

function extractFileSymbols(sourceFile: SourceFile): string[] {
  const exported = extractExportedSymbols(sourceFile)
  if (exported.length > 0) return exported

  return extractTopLevelSymbols(sourceFile)
}

function extractExportedSymbols(sourceFile: SourceFile): string[] {
  return [
    ...sourceFile
      .getExportDeclarations()
      .map((declaration) => compactLine(declaration.getText())),
    ...sourceFile.getFunctions().filter(isExportedNode).map(formatFunction),
    ...sourceFile.getClasses().filter(isExportedNode).map(formatClass),
    ...sourceFile.getInterfaces().filter(isExportedNode).map(formatInterface),
    ...sourceFile.getTypeAliases().filter(isExportedNode).map(formatTypeAlias),
    ...sourceFile.getEnums().filter(isExportedNode).map(formatEnum),
    ...sourceFile.getVariableStatements().filter(isExportedNode).map(formatVariableStatement),
  ].filter(Boolean)
}

function extractTopLevelSymbols(sourceFile: SourceFile): string[] {
  return [
    ...sourceFile.getFunctions().map(formatFunction),
    ...sourceFile.getClasses().map(formatClass),
    ...sourceFile.getInterfaces().map(formatInterface),
    ...sourceFile.getTypeAliases().map(formatTypeAlias),
    ...sourceFile.getEnums().map(formatEnum),
  ].filter(Boolean)
}

function formatFunction(declaration: FunctionDeclaration): string {
  return `function ${declaration.getName() ?? 'default'}${formatCallSignature(declaration)}`
}

function formatClass(declaration: ClassDeclaration): string {
  const name = declaration.getName() ?? 'default'
  const heritage = [
    declaration.getExtends() ? `extends ${declaration.getExtends()?.getText()}` : null,
    declaration.getImplements().length > 0
      ? `implements ${declaration.getImplements().map((item) => item.getText()).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
  const members = [
    ...declaration.getConstructors().filter(isPublicMember).map(formatConstructor),
    ...declaration.getMethods().filter(isPublicMember).map(formatMethod),
    ...declaration.getProperties().filter(isPublicMember).map(formatProperty),
  ]

  return compactLine(
    [
      `class ${name}${heritage ? ` ${heritage}` : ''}`,
      ...members.map((member) => `{ ${member} }`),
    ].join(' '),
  )
}

function formatInterface(declaration: InterfaceDeclaration): string {
  const name = declaration.getName()
  const heritage = declaration.getExtends().map((item) => item.getText())
  const members = [
    ...declaration.getMethods().map(formatMethodSignature),
    ...declaration.getProperties().map((property) => compactLine(property.getText())),
  ]

  return compactLine(
    [
      `interface ${name}${heritage.length > 0 ? ` extends ${heritage.join(', ')}` : ''}`,
      ...members.map((member) => `{ ${member} }`),
    ].join(' '),
  )
}

function formatTypeAlias(declaration: TypeAliasDeclaration): string {
  return compactLine(declaration.getText())
}

function formatEnum(declaration: EnumDeclaration): string {
  return `enum ${declaration.getName()}`
}

function formatVariableStatement(statement: VariableStatement): string {
  const declarations = statement.getDeclarations().map((declaration) => {
    const typeNode = declaration.getTypeNode()
    return `${declaration.getName()}${typeNode ? `: ${typeNode.getText()}` : ''}`
  })

  return `const ${declarations.join(', ')}`
}

function formatConstructor(declaration: ConstructorDeclaration): string {
  return `constructor${formatCallSignature(declaration)}`
}

function formatMethod(declaration: MethodDeclaration): string {
  const prefix = declaration.hasModifier(SyntaxKind.StaticKeyword) ? 'static ' : ''
  return `${prefix}${declaration.getName()}${formatCallSignature(declaration)}`
}

function formatMethodSignature(declaration: MethodSignature): string {
  return `${declaration.getName()}${formatCallSignature(declaration)}`
}

function formatProperty(declaration: PropertyDeclaration): string {
  const prefix = declaration.hasModifier(SyntaxKind.StaticKeyword) ? 'static ' : ''
  const typeNode = declaration.getTypeNode()
  return `${prefix}${declaration.getName()}${typeNode ? `: ${typeNode.getText()}` : ''}`
}

function formatCallSignature(declaration: {
  getParameters: () => { getText: () => string }[]
  getReturnTypeNode: () => { getText: () => string } | undefined
}): string {
  const parameters = declaration
    .getParameters()
    .map((parameter) => compactLine(parameter.getText()))
  const returnType = declaration.getReturnTypeNode()
  return `(${parameters.join(', ')})${returnType ? `: ${returnType.getText()}` : ''}`
}

function isExportedNode(node: {
  hasExportKeyword?: () => boolean
  isDefaultExport?: () => boolean
}): boolean {
  return node.hasExportKeyword?.() === true || node.isDefaultExport?.() === true
}

function isPublicMember(node: {
  hasModifier: (kind: SyntaxKind) => boolean
  getName?: () => string
}): boolean {
  const name = node.getName?.() ?? ''
  return (
    !name.startsWith('#') &&
    !node.hasModifier(SyntaxKind.PrivateKeyword) &&
    !node.hasModifier(SyntaxKind.ProtectedKeyword)
  )
}

function compactLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}
