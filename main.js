const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const { exec } = require('child_process')

let DATA_FILE
let SETTINGS_FILE

const GROUP_COLORS = ['#1a9fff','#27ae60','#9b59b6','#e67e22','#e74c3c','#16a085','#f39c12','#e91e8c']

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
      // Migrate old flat-array format
      if (Array.isArray(raw)) return { groups: [], apps: raw }
      return { groups: raw.groups || [], apps: raw.apps || [] }
    }
  } catch (e) {}
  return { groups: [], apps: [] }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

function findScreenshots(folderPath) {
  const dirs = ['screenshots', 'docs/screenshots', 'assets/screenshots', 'assets/images', 'images', 'media']
  for (const dir of dirs) {
    const p = path.join(folderPath, dir)
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        const files = fs.readdirSync(p)
          .filter(f => IMAGE_EXTS.some(ext => f.toLowerCase().endsWith(ext)))
          .map(f => path.join(p, f))
        if (files.length > 0) return files.slice(0, 8)
      }
    } catch (e) {}
  }
  try {
    return fs.readdirSync(folderPath)
      .filter(f => {
        try { return fs.statSync(path.join(folderPath, f)).isFile() && IMAGE_EXTS.some(ext => f.toLowerCase().endsWith(ext)) }
        catch (e) { return false }
      })
      .map(f => path.join(folderPath, f))
      .slice(0, 8)
  } catch (e) {}
  return []
}

function readDescription(folderPath) {
  for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
    const p = path.join(folderPath, file)
    if (!fs.existsSync(p)) continue
    try {
      const content = fs.readFileSync(p, 'utf8')
      const lines = content.split('\n')
      const desc = []
      for (const line of lines) {
        if (line.startsWith('#')) { if (desc.length > 0) break; continue }
        if (!line.trim()) { if (desc.length > 0) break; continue }
        desc.push(line.trim())
        if (desc.length >= 6) break
      }
      return desc.join(' ').slice(0, 600) || content.slice(0, 300)
    } catch (e) {}
  }
  return ''
}

function detectRunCommand(folderPath) {
  if (fs.existsSync(path.join(folderPath, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(folderPath, 'package.json'), 'utf8'))
      if (pkg.scripts?.dev) return 'npm run dev'
      if (pkg.scripts?.start) return 'npm start'
    } catch (e) {}
    return 'npm start'
  }
  if (fs.existsSync(path.join(folderPath, 'Cargo.toml'))) return 'cargo run'
  if (fs.existsSync(path.join(folderPath, 'main.py'))) return 'python main.py'
  if (fs.existsSync(path.join(folderPath, 'app.py'))) return 'python app.py'
  if (fs.existsSync(path.join(folderPath, 'index.py'))) return 'python index.py'
  if (fs.existsSync(path.join(folderPath, 'main.go'))) return 'go run .'
  if (fs.existsSync(path.join(folderPath, 'Makefile'))) return 'make'
  return ''
}

function processFolder(folderPath) {
  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return { error: 'Path is not a directory' }
  }
  return {
    id: generateId(),
    name: path.basename(folderPath),
    path: folderPath,
    groupId: null,
    description: readDescription(folderPath),
    screenshots: findScreenshots(folderPath),
    runCommand: detectRunCommand(folderPath),
    deployCommand: '',
    addedAt: new Date().toISOString()
  }
}

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1923',
    show: false
  })
  mainWindow.loadFile('index.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

app.whenReady().then(() => {
  DATA_FILE = path.join(app.getPath('userData'), 'appshelf-apps.json')
  SETTINGS_FILE = path.join(app.getPath('userData'), 'appshelf-settings.json')
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── IPC: Data ──────────────────────────────────────
ipcMain.handle('get-data', () => loadData())

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections']
  })
  return result.canceled ? [] : result.filePaths
})

// ── IPC: Apps ──────────────────────────────────────
ipcMain.handle('add-apps', async (_, folderPaths) => {
  const data = loadData()
  const results = []
  for (const folderPath of folderPaths) {
    if (data.apps.find(a => a.path === folderPath)) {
      results.push({ error: 'App already added', path: folderPath }); continue
    }
    const appData = processFolder(folderPath)
    if (appData.error) { results.push({ ...appData, path: folderPath }); continue }
    data.apps.push(appData)
    results.push(appData)
  }
  saveData(data)
  return results
})

ipcMain.handle('update-app', async (_, updatedApp) => {
  const data = loadData()
  const idx = data.apps.findIndex(a => a.id === updatedApp.id)
  if (idx === -1) return { error: 'App not found' }
  data.apps[idx] = { ...data.apps[idx], ...updatedApp }
  saveData(data)
  return data.apps[idx]
})

ipcMain.handle('delete-app', async (_, appId) => {
  const data = loadData()
  data.apps = data.apps.filter(a => a.id !== appId)
  saveData(data)
  return true
})

ipcMain.handle('move-app', async (_, { appId, groupId }) => {
  const data = loadData()
  const idx = data.apps.findIndex(a => a.id === appId)
  if (idx === -1) return { error: 'App not found' }
  data.apps[idx].groupId = groupId || null
  saveData(data)
  return data.apps[idx]
})

// ── IPC: Groups ────────────────────────────────────
ipcMain.handle('add-group', async (_, name) => {
  const data = loadData()
  const color = GROUP_COLORS[data.groups.length % GROUP_COLORS.length]
  const group = { id: generateId(), name, color }
  data.groups.push(group)
  saveData(data)
  return group
})

ipcMain.handle('update-group', async (_, group) => {
  const data = loadData()
  const idx = data.groups.findIndex(g => g.id === group.id)
  if (idx === -1) return { error: 'Group not found' }
  data.groups[idx] = { ...data.groups[idx], ...group }
  saveData(data)
  return data.groups[idx]
})

ipcMain.handle('delete-group', async (_, groupId) => {
  const data = loadData()
  data.groups = data.groups.filter(g => g.id !== groupId)
  data.apps = data.apps.map(a => a.groupId === groupId ? { ...a, groupId: null } : a)
  saveData(data)
  return true
})

// ── IPC: Run & Deploy ──────────────────────────────
ipcMain.handle('run-app', async (_, appId) => {
  const { apps } = loadData()
  const app_data = apps.find(a => a.id === appId)
  if (!app_data) return { error: 'App not found' }
  if (!app_data.runCommand) return { error: 'No run command configured' }

  const escapedPath = app_data.path.replace(/"/g, '\\"')
  const escapedCmd = app_data.runCommand.replace(/"/g, '\\"').replace(/'/g, "'\\''")
  const script = `tell application "Terminal"\n    activate\n    do script "cd \\"${escapedPath}\\" && ${escapedCmd}"\n  end tell`

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) exec(`osascript -e 'tell application "iTerm2" to create window with default profile command "cd \\"${escapedPath}\\" && ${escapedCmd}"'`)
  })
  return { success: true }
})

ipcMain.handle('deploy-app', async (_, appId) => {
  const { apps } = loadData()
  const app_data = apps.find(a => a.id === appId)
  if (!app_data) return { error: 'App not found' }

  const portfolio = getPortfolioSettings()
  const steps = []

  // Step 1: app-level deploy command (optional)
  if (app_data.deployCommand) {
    await new Promise(res => {
      exec(app_data.deployCommand, { cwd: app_data.path, timeout: 120000 }, (err, stdout, stderr) => {
        steps.push({ step: 'deploy-app', result: err ? { error: err.message, stdout, stderr } : { success: true, stdout, stderr } })
        res()
      })
    })
  } else {
    steps.push({ step: 'deploy-app', result: { skipped: true } })
  }

  // Step 2: inject entry into portfolio file
  if (portfolio.filePath && portfolio.entryTemplate) {
    try {
      if (!fs.existsSync(portfolio.filePath)) throw new Error('Portfolio file not found: ' + portfolio.filePath)
      let content = fs.readFileSync(portfolio.filePath, 'utf8')

      // Find marker for this app's group
      const mappings = portfolio.categoryMappings || []
      let marker = null
      if (app_data.groupId) {
        const m = mappings.find(m => m.groupId === app_data.groupId)
        if (m) marker = m.marker
      }
      if (!marker) {
        const def = mappings.find(m => m.groupId === null || m.groupId === undefined || m.groupId === '')
        if (def) marker = def.marker
      }
      if (!marker) throw new Error('No portfolio marker configured for this app\'s group')
      if (!content.includes(marker)) throw new Error(`Marker "${marker}" not found in portfolio file`)

      const entry = portfolio.entryTemplate
        .replace(/\{\{name\}\}/g, app_data.name)
        .replace(/\{\{description\}\}/g, app_data.description || '')
        .replace(/\{\{githubUrl\}\}/g, app_data.githubUrl || '')
        .replace(/\{\{runCommand\}\}/g, app_data.runCommand || '')
        .replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0])
        .replace(/\{\{year\}\}/g, new Date().getFullYear().toString())
      content = content.replace(marker, marker + '\n' + entry)
      fs.writeFileSync(portfolio.filePath, content)
      steps.push({ step: 'update-portfolio', result: { success: true } })
    } catch (e) {
      steps.push({ step: 'update-portfolio', result: { error: e.message } })
    }
  } else {
    steps.push({ step: 'update-portfolio', result: { skipped: true } })
  }

  // Step 3: portfolio-level deploy command
  if (portfolio.deployCommand && portfolio.filePath) {
    const portfolioDir = path.dirname(portfolio.filePath)
    await new Promise(res => {
      exec(portfolio.deployCommand, { cwd: portfolioDir, timeout: 180000 }, (err, stdout, stderr) => {
        steps.push({ step: 'deploy-portfolio', result: err ? { error: err.message, stdout, stderr } : { success: true, stdout, stderr } })
        res()
      })
    })
  } else {
    steps.push({ step: 'deploy-portfolio', result: { skipped: true } })
  }

  return { success: !steps.some(s => s.result.error), steps }
})

// ── IPC: Run command by string ─────────────────────
ipcMain.handle('run-command-in', async (_, { folderPath, command }) => {
  const escapedPath = folderPath.replace(/"/g, '\\"')
  const escapedCmd = command.replace(/"/g, '\\"').replace(/'/g, "'\\''")
  const script = `tell application "Terminal"\n    activate\n    do script "cd \\"${escapedPath}\\" && ${escapedCmd}"\n  end tell`
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) exec(`osascript -e 'tell application "iTerm2" to create window with default profile command "cd \\"${escapedPath}\\" && ${escapedCmd}"'`)
  })
  return { success: true }
})

// ── Portfolio helpers ───────────────────────────────
function getPortfolioSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      return s.portfolio || {}
    }
  } catch (e) {}
  return {}
}

async function checkUrlForText(url, text) {
  return new Promise(resolve => {
    try {
      const mod = url.startsWith('https') ? https : http
      const req = mod.get(url, { timeout: 8000 }, res => {
        let body = ''
        res.on('data', chunk => { body += chunk; if (body.length > 500000) req.destroy() })
        res.on('end', () => resolve(body.toLowerCase().includes(text.toLowerCase())))
        res.on('error', () => resolve(null))
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    } catch (e) { resolve(null) }
  })
}

ipcMain.handle('get-portfolio-settings', () => getPortfolioSettings())

ipcMain.handle('save-portfolio-settings', async (_, portfolio) => {
  let settings = {}
  try {
    if (fs.existsSync(SETTINGS_FILE)) settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch (e) {}
  settings.portfolio = portfolio
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return true
})

// ── IPC: Settings ──────────────────────────────────
ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

// ── IPC: Export / Import ───────────────────────────
ipcMain.handle('export-data', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export AppShelf Data',
    defaultPath: `appshelf-${new Date().toISOString().slice(0,10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled) return { canceled: true }
  const data = loadData()
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2))
  return { success: true, path: result.filePath }
})

ipcMain.handle('import-data', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import AppShelf Data',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled) return { canceled: true }

  let imported
  try {
    imported = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
  } catch (e) {
    return { error: 'Invalid JSON file: ' + e.message }
  }

  // Support both { groups, apps } format and legacy flat array
  if (Array.isArray(imported)) imported = { groups: [], apps: imported }
  if (!imported.apps) return { error: 'No apps found in file' }

  const data = loadData()
  let addedGroups = 0, skippedGroups = 0, addedApps = 0, skippedApps = 0

  // Merge groups by id — skip if id already exists
  for (const group of imported.groups || []) {
    if (data.groups.find(g => g.id === group.id)) { skippedGroups++; continue }
    data.groups.push(group)
    addedGroups++
  }

  // Merge apps by path — path is the real unique key
  for (const app of imported.apps || []) {
    if (data.apps.find(a => a.path === app.path)) { skippedApps++; continue }
    // If the app's groupId no longer exists in current data, ungroup it
    if (app.groupId && !data.groups.find(g => g.id === app.groupId)) app.groupId = null
    data.apps.push(app)
    addedApps++
  }

  saveData(data)
  return { success: true, addedApps, skippedApps, addedGroups, skippedGroups, data }
})

ipcMain.handle('get-settings', () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      return { ...s, hasEnvKey: !!process.env.ANTHROPIC_API_KEY }
    }
  } catch (e) {}
  return { hasEnvKey: !!process.env.ANTHROPIC_API_KEY }
})

ipcMain.handle('save-settings', async (_, settings) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return true
})

function getApiKey() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      if (s.anthropicApiKey) return s.anthropicApiKey
    }
  } catch (e) {}
  return process.env.ANTHROPIC_API_KEY || ''
}

// ── Enrichment helpers ─────────────────────────────
const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build', 'target', '.next', '.nuxt', 'coverage', 'venv', '.venv', 'vendor'])

function dirTree(dirPath, depth = 2, prefix = '') {
  if (depth === 0) return ''
  try {
    const items = fs.readdirSync(dirPath)
      .filter(f => !f.startsWith('.') || f === '.env.example')
      .filter(f => !IGNORE_DIRS.has(f))
      .slice(0, 40)
    return items.map(item => {
      const full = path.join(dirPath, item)
      let stat
      try { stat = fs.statSync(full) } catch (e) { return null }
      const isDir = stat.isDirectory()
      const line = prefix + (isDir ? '/' : ' ') + item
      if (isDir && depth > 1) return line + '\n' + dirTree(full, depth - 1, prefix + '  ')
      return line
    }).filter(Boolean).join('\n')
  } catch (e) { return '' }
}

function readGitRemoteUrl(folderPath) {
  try {
    const gitConfig = fs.readFileSync(path.join(folderPath, '.git', 'config'), 'utf8')
    const match = gitConfig.match(/url\s*=\s*(.+)/i)
    if (!match) return null
    let url = match[1].trim()
    // SSH → HTTPS
    url = url.replace(/^git@github\.com:/, 'https://github.com/')
    url = url.replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
    url = url.replace(/^git@bitbucket\.org:/, 'https://bitbucket.org/')
    url = url.replace(/\.git$/, '')
    return url
  } catch (e) { return null }
}

function gatherFolderContext(folderPath) {
  const KEY_FILES = [
    'package.json', 'Makefile', 'Cargo.toml', 'pyproject.toml',
    'setup.py', 'go.mod', 'docker-compose.yml', 'docker-compose.yaml',
    'Procfile', 'requirements.txt', 'pnpm-workspace.yaml', 'lerna.json',
    'turbo.json', 'nx.json', '.env.example', 'justfile', 'taskfile.yml',
  ]
  const files = []
  for (const f of KEY_FILES) {
    const p = path.join(folderPath, f)
    if (!fs.existsSync(p)) continue
    try {
      const content = fs.readFileSync(p, 'utf8').slice(0, 2500)
      files.push({ name: f, content })
    } catch (e) {}
  }
  // Also look in a scripts/ dir
  const scriptsDir = path.join(folderPath, 'scripts')
  if (fs.existsSync(scriptsDir)) {
    try {
      fs.readdirSync(scriptsDir).slice(0, 6).forEach(f => {
        files.push({ name: `scripts/${f}`, content: '(script file)' })
      })
    } catch (e) {}
  }
  return { structure: dirTree(folderPath, 2), files }
}

async function callClaudeEnrich(context, options, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const prompt = `Analyze this software project. Return ONLY a JSON object — no markdown, no explanation.

Directory structure:
${context.structure}

${context.files.map(f => `=== ${f.name} ===\n${f.content}`).join('\n\n')}

Return exactly this JSON shape:
{
  "runCommands": [{"name": "short label (Dev/Start/Test/Build etc)", "command": "exact shell command"}],
  "subApps": [{"name": "service name", "relPath": "path/relative/to/root", "runCommand": "command"}]
}

Rules:
- runCommands: include ALL distinct ways to run/start/develop/test this project. Look at package.json scripts, Makefile targets, Procfile entries, Docker commands, Python/Go/Rust entry points.
${!options.runCommands ? '- Set runCommands to []' : ''}
- subApps: only include genuinely separate runnable services (monorepo packages, separate frontend+backend, etc). Empty array if none.
${!options.subApps ? '- Set subApps to []' : ''}
- Return valid JSON only. Empty arrays are fine.`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].text.trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { runCommands: [], subApps: [] }
  try { return JSON.parse(match[0]) } catch (e) { return { runCommands: [], subApps: [] } }
}

// ── IPC: Enrich ────────────────────────────────────
ipcMain.handle('enrich-apps', async (_, { appIds, options }) => {
  const apiKey = getApiKey()
  if ((options.runCommands || options.subApps) && !apiKey) {
    return { error: 'No Anthropic API key set. Add it in Settings.' }
  }

  const data = loadData()

  for (const appId of appIds) {
    const appIdx = data.apps.findIndex(a => a.id === appId)
    if (appIdx === -1) continue
    const app_data = data.apps[appIdx]

    mainWindow.webContents.send('enrich-progress', { appId, status: 'processing' })

    try {
      const enriched = {}

      // GitHub URL (deterministic)
      if (options.githubUrl) {
        const url = readGitRemoteUrl(app_data.path)
        if (url) enriched.githubUrl = url
      }

      // AI enrichment
      if (options.runCommands || options.subApps) {
        const context = gatherFolderContext(app_data.path)
        const ai = await callClaudeEnrich(context, options, apiKey)
        if (options.runCommands && ai.runCommands?.length) {
          enriched.runCommands = ai.runCommands
          // Promote first command to primary if none set
          if (!app_data.runCommand) enriched.runCommand = ai.runCommands[0].command
        }
        if (options.subApps && ai.subApps?.length) {
          enriched.subApps = ai.subApps
        }
      }

      // Deploy status check
      if (options.deployCheck) {
        const portfolio = getPortfolioSettings()
        const appName = app_data.name
        let inPortfolio = null
        let isLive = null

        if (portfolio.filePath && fs.existsSync(portfolio.filePath)) {
          try {
            const content = fs.readFileSync(portfolio.filePath, 'utf8')
            inPortfolio = content.toLowerCase().includes(appName.toLowerCase())
          } catch (e) { inPortfolio = null }
        }

        if (portfolio.liveUrl) {
          isLive = await checkUrlForText(portfolio.liveUrl, appName)
        }

        enriched.deployStatus = { inPortfolio, isLive, checkedAt: new Date().toISOString() }
      }

      data.apps[appIdx] = { ...app_data, ...enriched }
      saveData(data)
      mainWindow.webContents.send('enrich-progress', { appId, status: 'done', result: data.apps[appIdx] })
    } catch (e) {
      mainWindow.webContents.send('enrich-progress', { appId, status: 'error', error: e.message })
    }
  }

  return { success: true }
})
