const electron = require('electron')
const express = require('express')
const https = require('https')
const fs = require('fs')
const { execSync } = require('child_process')

const managementPort = 45457 //? HTTP Toolkit's local management port
const killProcessOnPort = (targetPort) => {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${targetPort}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      const pids = new Set(out.split(/\r?\n/).filter(l => l.includes('LISTENING')).map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p) && +p !== process.pid))
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }) } catch (e) { console.warn(`[Patcher] Failed to kill PID ${pid}`, e.message) }
      }
      if (pids.size) console.log(`[Patcher] Killed ${pids.size} process(es) holding port ${targetPort}`)
    } else {
      let pids = []
      try {
        const out = execSync(`lsof -ti :${targetPort}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
        pids = out.split(/\r?\n/).map(l => l.trim()).filter(p => /^\d+$/.test(p) && +p !== process.pid)
      } catch (e) {
        try {
          const out = execSync(`fuser ${targetPort}/tcp`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
          pids = out.split(/\s+/).map(p => p.trim()).filter(p => /^\d+$/.test(p) && +p !== process.pid)
        } catch (e) { /* Port is already free */ }
      }
      for (const pid of pids) {
        try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }) } catch (e) { console.warn(`[Patcher] Failed to kill PID ${pid}`, e.message) }
      }
      if (pids.length) console.log(`[Patcher] Killed ${pids.length} process(es) holding port ${targetPort}`)
    }
  } catch (e) { /* Nothing listening on the port */ }
}

killProcessOnPort(managementPort)

const request = (method, url, redirectCount = 0) => new Promise((resolve, reject) => {
  const { HttpsProxyAgent } = globalProxy ? require('https-proxy-agent') : { HttpsProxyAgent: undefined }
  const agent = globalProxy ? new HttpsProxyAgent(globalProxy.startsWith('http') ? globalProxy.replace(/^http:/, 'https:') : 'https://' + globalProxy) : undefined //? Use proxy if set (globalProxy is injected by the patcher)
  const req = https.request(url, { method, agent }, res => {
    let data = Buffer.alloc(0)

    res.on('data', chunk => data = Buffer.concat([data, chunk]))

    res.on('end', () => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= 5) {
          reject(new Error('Too many redirects'))
          return
        }
        resolve(request(method, res.headers.location, redirectCount + 1))
        return
      }
      resolve({
        data,
        statusCode: res.statusCode,
        headers: res.headers
      })
    })
  })

  req.on('error', reject)

  req.end()
})

const hasInternet = () => request('HEAD', 'https://app.httptoolkit.tech').then(r => r.statusCode >= 200 && r.statusCode < 400).catch(() => false)

const port = process.env.PORT || 5067
killProcessOnPort(port)
const tempPath = path.join(os.tmpdir(), 'httptoolkit-patch')

process.env.APP_URL = `http://localhost:${port}`
console.log(`[Patcher] Selected temp path: ${tempPath}`)

const app = express()

app.disable('x-powered-by')

app.all(/.*/, async (req, res) => {
  console.log(`[Patcher] Request to: ${req.url}`)

  let filePath = path.join(tempPath, new URL(req.url, process.env.APP_URL).pathname === '/' ? 'index.html' : new URL(req.url, process.env.APP_URL).pathname)
  if (['/view', '/intercept', '/settings', '/mock'].includes(new URL(req.url, process.env.APP_URL).pathname)) {
    filePath += '.html'
  }

  //? Prevent loading service worker to avoid caching issues
  if (new URL(req.url, process.env.APP_URL).pathname === '/ui-update-worker.js') return res.status(404).send('Not found')

  if (!fs.existsSync(tempPath)) {
    console.log(`[Patcher] Temp path not found, creating: ${tempPath}`)
    fs.mkdirSync(tempPath)
  }

  if (!(await hasInternet())) {
    console.log(`[Patcher] No internet connection, trying to serve directly from temp path`)
    if (fs.existsSync(filePath)) {
      console.log(`[Patcher] Serving from temp path: ${filePath}`)
      res.sendFile(filePath)
    } else {
      console.log(`[Patcher] File not found in temp path: ${filePath}`)
      res.status(404).send('No internet connection and file is not cached')
    }
    return
  }

  try {
    if (fs.existsSync(filePath)) { //? Check if file exists in temp path
      try {
        const remoteDate = await request('HEAD', `https://app.httptoolkit.tech${req.url}`).then(res => new Date(res.headers['last-modified']))
        if (remoteDate < new Date(fs.statSync(filePath).mtime)) {
          console.log(`[Patcher] File not changed, serving from temp path`)
          res.sendFile(filePath)
          return
        }
      } catch (e) {
        console.error(`[Patcher] [ERR] Failed to fetch remote file date`, e)
      }
    } else console.log(`[Patcher] File not found in temp path, downloading`)

    const remoteFile = await request('GET', `https://app.httptoolkit.tech${req.url}`)

    for (const [key, value] of Object.entries(remoteFile.headers)) res.setHeader(key, value)

    const recursiveMkdir = dir => {
      if (!fs.existsSync(dir)) {
        recursiveMkdir(path.dirname(dir))
        fs.mkdirSync(dir)
      }
    }

    recursiveMkdir(path.dirname(filePath))
    let data = remoteFile.data
    if (new URL(req.url, process.env.APP_URL).pathname === '/main.js') { //? Patch main.js
      console.log(`[Patcher] Patching main.js`)
      res.setHeader('Cache-Control', 'no-store') //? Prevent caching

      data = data.toString()

      const accStoreName = data.match(/class ([0-9A-Za-z_]+){constructor\(e\){this\.goToSettings=e/)?.[1]
      const modName = data.match(/([0-9A-Za-z_]+).(getLatestUserData|getLastUserData)/)?.[1]

      if (!accStoreName) console.error(`[Patcher] [ERR] Account store name not found in main.js`)
      else if (!modName) console.error(`[Patcher] [ERR] Module name not found in main.js`)
      else {
        let patched = data
          .replace(`class ${accStoreName}{`, `["getLatestUserData","getLastUserData"].forEach(p=>Object.defineProperty(${modName},p,{value:()=>user}));class ${accStoreName}{`)
        if (patched === data) console.error(`[Patcher] [ERR] Patch failed`)
        else {
          patched = `const user=(t=>{const e=t.subscription?.status;return Object.assign(t,{isStatusUnexpired(){const r=t.subscription?.expiry,o="active"===t.subscription?.status?6048e5:0;return!!r&&r.valueOf()+o>Date.now()},isPaidUser(){return"past_due"!==t.subscription?.status&&t.isStatusUnexpired()},isPastDueUser(){return"past_due"===t.subscription?.status&&t.isStatusUnexpired()},userHasSubscription(){return this.isPaidUser()||this.isPastDueUser()}})})(${JSON.stringify({
            userId: 'email|' + email, //? Injected by the patcher
            email, //? Injected by the patcher
            subscription: {
              status: 'active',
              plan: 'pro-annual',
              sku: 'pro-annual',
              tierCode: 'pro',
              interval: 'annual',
              quantity: 1,
              expiry: (() => { const d = new Date(Date.now() + 6767 * 365 * 24 * 60 * 60 * 1000); return d; })().toISOString(),
            },
            teamSubscription: undefined,
            featureFlags: [],
            banned: false,
          })});user.subscription.expiry=new Date(user.subscription.expiry);` + patched
          data = patched
          console.log(`[Patcher] main.js patched`)
        }
      }
    }
    fs.writeFileSync(filePath, data)
    console.log(`[Patcher] File downloaded and saved: ${filePath}`)
    res.sendFile(filePath)
  } catch (e) {
    console.error(`[Patcher] [ERR] Failed to fetch remote file: ${filePath}`, e)
    res.status(500).send('Internal server error')
  }
})

app.listen(port, () => console.log(`[Patcher] Server listening on port ${port}`))

electron.app.on('ready', () => {
  //? Patching CORS headers to allow requests from localhost
  electron.session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    //* Blocking unwanted requests to prevent tracking
    const blockedHosts = ['events.httptoolkit.tech']
    if (blockedHosts.includes(new URL(details.url).hostname) || details.url.includes('sentry')) return callback({ cancel: true })
    details.requestHeaders.Origin = 'https://app.httptoolkit.tech'
    callback({ requestHeaders: details.requestHeaders })
  })
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders['Access-Control-Allow-Origin'] = [`http://localhost:${port}`]
    delete details.responseHeaders['access-control-allow-origin']
    callback({ responseHeaders: details.responseHeaders })
  })
})