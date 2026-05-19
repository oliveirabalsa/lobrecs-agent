import * as nodePty from 'node-pty'
import {
  CliEditorTerminalService,
  type PtySpawnOptions,
} from './cliEditorTerminal'

export const cliEditorTerminalService = new CliEditorTerminalService({
  spawnPty: (command: string, args: string[], options: PtySpawnOptions) =>
    nodePty.spawn(command, args, options),
})
