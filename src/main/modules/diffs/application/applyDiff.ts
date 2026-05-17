import fs from 'node:fs/promises'

export async function applyDiffContent(
  filePath: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  if (expectedContent !== undefined) {
    const currentContent = await fs.readFile(filePath, 'utf-8')
    if (currentContent !== expectedContent) {
      throw new Error(
        'The file changed since this diff was generated. Review the latest file before applying.',
      )
    }
  }

  const backupPath = `${filePath}.lobrecs-agent-backup`
  await fs.copyFile(filePath, backupPath)
  await fs.writeFile(filePath, content, 'utf-8')
  await fs.unlink(backupPath)
}
