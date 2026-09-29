import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const localBuildEnv = {
  ...process.env,
  VITE_API_ORIGIN: 'http://localhost:5050',
  VITE_WS_ORIGIN: 'ws://localhost:5051/ws'
}
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('npm_execpath is required to build the Windows package')

run(process.execPath, [npmCli, 'run', 'build'], localBuildEnv)
run(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/electron-builder/out/cli/cli.js', import.meta.url)),
    '--win',
    '--config'
  ],
  localBuildEnv
)
