// @ts-check
import { spawn } from 'child_process'
import asar from '@electron/asar'
import prompts from 'prompts'
import yargs from 'yargs'
import chalk from 'chalk'
import path from 'path'
import fs from 'fs'
import os from 'os'

const argv = await yargs(process.argv.slice(2))
  .usage(`Usage: ${process.argv0} . <command> [options]`)
  .command('patch', 'Patch HTTP Toolkit using the specified script')
  .command('restore', 'Restore HTTP Toolkit files to their original state')
  .command('start', 'Start HTTP Toolkit')
  .demandCommand(1, 'You need at least one command before moving on')
  .alias('h', 'help')
  .parse()

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

const appPath =
  isWin ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'HTTP Toolkit', 'resources')
  : isMac ? '/Applications/HTTP Toolkit.app/Contents/Resources'
  : fs.existsSync('/opt/HTTP Toolkit/resources') ? '/opt/HTTP Toolkit/resources'
  : '/opt/httptoolkit/resources'

const isSudo = !isWin && (process.getuid || (() => process.env.SUDO_UID ? 0 : null))() === 0

if (+(process.versions.node.split('.')[0]) < 15) {
  console.error(chalk.redBright`[!] Node.js version 15 or higher is recommended, you are using version {bold ${process.versions.node}}`)
}

if (!fs.existsSync(path.join(appPath, 'app.asar'))) {
  console.error(chalk.redBright`[-] HTTP Toolkit not found`)
  process.exit(1)
}

console.log(chalk.blueBright`[+] HTTP Toolkit found at {bold ${path.dirname(appPath)}}`)

const rm = dirPath => {
  if (!fs.existsSync(dirPath)) return
  if (!fs.lstatSync(dirPath).isDirectory()) return fs.rmSync(dirPath, { force: true })
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry)
    if (fs.lstatSync(entryPath).isDirectory()) rm(entryPath)
    else fs.rmSync(entryPath, { force: true })
  }
}

/** @type {Array<import('child_process').ChildProcess>} */
const activeProcesses = []
let isCancelled = false

const cleanUp = async () => {
  isCancelled = true
  console.log(chalk.redBright`[-] Operation cancelled, cleaning up...`)
  if (activeProcesses.length) {
    console.log(chalk.yellowBright`[+] Killing active processes...`)
    for (const proc of activeProcesses) {
      proc.kill('SIGINT')
      console.log(chalk.yellowBright`[+] Process {bold ${proc.pid ? process.pid + ' ' : ''}}killed`)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const paths = [
    path.resolve(os.tmpdir(), 'httptoolkit-patch'),
    path.resolve(appPath, 'app')
  ]
  try {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log(chalk.yellowBright`[+] Removing {bold ${p}}`)
        rm(p)
      }
    }
  } catch (e) {
    console.error(chalk.redBright`[-] An error occurred while cleaning up`, e)
  }
  process.exit(1)
}

const patchApp = async () => {
  const filePath = path.join(appPath, 'app.asar')
  const tempPath = path.join(appPath, 'app')
  
  if (fs.readFileSync(filePath).includes('Injected by HTTP Toolkit Patcher')) {
    console.log(chalk.greenBright`[+] App already patched`)
    return
  }

  const globalProxy = process.env.PROXY

  console.log(chalk.blueBright`[+] Started patching app...`)

  if (globalProxy) {
    if (!globalProxy.match(/^https?:/)) {
      console.error(chalk.redBright`[-] Global proxy must start with http:// or https://`)
      process.exit(1)
    }
    console.log(chalk.yellowBright`[+] Adding a custom proxy: {bold ${globalProxy}}`)
  }

  console.log(chalk.yellowBright`[+] Extracting app...`)

  ;['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, cleanUp))

  try {
    rm(tempPath)
    asar.extractAll(filePath, tempPath)
  } catch (e) {
    if (!isSudo && e.errno === -13) { //? Permission denied
      console.error(chalk.redBright`[-] Permission denied${!isWin ? ', try running with sudo' : ', try running node as administrator'}`)
      process.exit(1)
    }
    console.error(chalk.redBright`[-] An error occurred while extracting app`, e)
    process.exit(1)
  }

  const indexPath = path.join(tempPath, 'build', 'index.js')
  if (!fs.existsSync(indexPath)) {
    console.error(chalk.redBright`[-] Index file not found`)
    cleanUp()
  }
  const data = fs.readFileSync(indexPath, 'utf-8')
  ;['SIGINT', 'SIGTERM'].forEach(signal => process.off(signal, cleanUp))
  const { email } = await prompts({
    type: 'text',
    name: 'email',
    message: 'Enter a email for the pro plan',
    validate: value => value.includes('@') || 'Invalid email'
  })
  if (!email || typeof email !== 'string') {
    console.error(chalk.redBright`[-] Email not provided`)
    cleanUp()
  }
  ;['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, cleanUp))
  const patch = fs.readFileSync('patch.js', 'utf-8')
  const patchedData = data
    .replace('const APP_URL =', `// ------- Injected by HTTP Toolkit Patcher -------\nconst email = \`${email.replace(/`/g, '\\`')}\`\nconst globalProxy = process.env.PROXY ?? \`${globalProxy ? globalProxy.replace(/`/g, '\\`') : ''}\`\n${patch}\n// ------- End patched content -------\nconst APP_URL =`)

  if (data === patchedData || !patchedData) {
    console.error(chalk.redBright`[-] Patch failed`)
    cleanUp()
  }

  fs.writeFileSync(indexPath, patchedData, 'utf-8')
  console.log(chalk.greenBright`[+] Patched index.js`)
  console.log(chalk.yellowBright`[+] Installing dependencies...`)
  try {
    const proc = spawn('npm install express', { cwd: tempPath, stdio: 'inherit', shell: true })
    activeProcesses.push(proc)
    await new Promise(resolve =>
      proc.on('close', resolve)
    )
    activeProcesses.splice(activeProcesses.indexOf(proc), 1)
    if (isCancelled) return
  } catch (e) {
    console.error(chalk.redBright`[-] An error occurred while installing dependencies`, e)
    cleanUp()
  }
  rm(path.join(tempPath, 'package-lock.json'))
  fs.copyFileSync(filePath, `${filePath}.bak`)
  console.log(chalk.greenBright`[+] Backup created at {bold ${filePath}.bak}`)
  console.log(chalk.yellowBright`[+] Building app...`)
  await asar.createPackage(tempPath, filePath)
  rm(tempPath)
  console.log(chalk.greenBright`[+] App patched`)
}

switch (argv._[0]) {
  case 'patch':
    await patchApp()
    break
  case 'restore':
    try {
      console.log(chalk.blueBright`[+] Restoring app...`)
      if (!fs.existsSync(path.join(appPath, 'app.asar.bak')))
        console.error(chalk.redBright`[-] App not patched or restore file not found`)
      else {
        fs.copyFileSync(path.join(appPath, 'app.asar.bak'), path.join(appPath, 'app.asar'))
        console.log(chalk.greenBright`[+] App restored`)
      }
      rm(path.join(os.tmpdir(), 'httptoolkit-patch'))
    } catch (e) {
      if (!isSudo && e.errno === -13) { //? Permission denied
        console.error(chalk.redBright`[-] Permission denied${!isWin ? ', try running with sudo' : ', try running node as administrator'}`)
        process.exit(1)
      }
      console.error(chalk.redBright`[-] An error occurred`, e)
      process.exit(1)
    }
    break
  case 'start':
    console.log(chalk.blueBright`[+] Starting HTTP Toolkit...`)
    try {
      const command =
        isWin ? `"${path.resolve(appPath, '..', 'HTTP Toolkit.exe')}"`
        : isMac ? 'open -a "HTTP Toolkit"'
        : 'httptoolkit'
      const proc = spawn(command, { stdio: 'inherit', shell: true })
      proc.on('close', code => process.exit(code))
    } catch (e) {
      console.error(chalk.redBright`[-] An error occurred`, e)
      if (isSudo) console.error(chalk.redBright`[-] Try running without sudo`)
      process.exit(1)
    }
    break
  default:
    console.error(chalk.redBright`[-] Unknown command`)
    process.exit(1)
}

if (!isCancelled) console.log(chalk.greenBright`[+] Done`)
