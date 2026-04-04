// ── State ──────────────────────────────────────────
let groups = []
let apps = []
let ignoredPaths = new Set()
let viewMode = 'grid' // 'grid' | 'list'
let current = null
let slideIdx = 0
let selected = new Set()        // selected app IDs
let enriching = new Set()       // app IDs currently being enriched
let portfolioIds = new Set()    // slugified IDs of apps in PersonalTrailblazer portfolio
let searchQuery = ''

// ── Icon generation ────────────────────────────────
const PALETTES = [
  ['#0d2137','#1a9fff'],['#0d2b1a','#27ae60'],['#2b0d2b','#9b59b6'],
  ['#2b1a0d','#e67e22'],['#2b0d13','#e74c3c'],['#0d2b28','#16a085'],
  ['#1a1a2b','#7f8ef7'],['#2b1a1a','#e05252'],
]
function palette(name) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTES[h % PALETTES.length]
}
function iconSVG(name) {
  const letter = (name[0] || '?').toUpperCase()
  const [dark, light] = palette(name)
  return 'data:image/svg+xml,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${dark}"/>
      </linearGradient></defs>
      <rect width="100" height="100" rx="22" fill="url(#g)"/>
      <text x="50" y="54" font-family="-apple-system,sans-serif" font-size="54" font-weight="800"
        fill="rgba(255,255,255,0.95)" text-anchor="middle" dominant-baseline="middle">${letter}</text>
    </svg>`)
}
function appIcon(app) {
  if (app.screenshots?.length) return `file://${app.screenshots[0]}`
  return iconSVG(app.name)
}

// ── Deploy status line ──────────────────────────────
function renderDeployStatusLine(app) {
  const ds = app.deployStatus
  if (!ds || (ds.inPortfolio === null && ds.isLive === null)) return ''
  const fmtDot = (val, trueLabel, falseLabel) => {
    if (val === true) return `<span class="dot-ok">●</span> ${trueLabel}`
    if (val === false) return `<span class="dot-fail">✗</span> ${falseLabel}`
    return `<span class="dot-null">○</span> Unknown`
  }
  let age = ''
  if (ds.checkedAt) {
    const diff = Math.round((Date.now() - new Date(ds.checkedAt).getTime()) / 60000)
    if (diff < 60) age = `${diff}m ago`
    else if (diff < 1440) age = `${Math.round(diff/60)}h ago`
    else age = `${Math.round(diff/1440)}d ago`
  }
  return `<div class="deploy-status-line">${fmtDot(ds.inPortfolio, 'In portfolio', 'Not in portfolio')} · ${fmtDot(ds.isLive, 'Live', 'Not live')}${age ? ` · checked ${age}` : ''}</div>`
}

// ── Deploy status helpers ───────────────────────────
function deployBtnClass(app) {
  const ds = app.deployStatus
  if (!ds) return 'btn-accent'
  const { inPortfolio, isLive } = ds
  if (inPortfolio === true && isLive === true) return 'deploy-green'
  if (inPortfolio === true || isLive === true) return 'deploy-yellow'
  return 'btn-accent'
}
function deployBtnIcon(app) {
  const ds = app.deployStatus
  if (!ds) return '⬆'
  const { inPortfolio, isLive } = ds
  if (inPortfolio === true && isLive === true) return '✓'
  if (inPortfolio === true || isLive === true) return '~'
  return '⬆'
}
function deployBtnTitle(app) {
  const ds = app.deployStatus
  if (!ds) return 'Deploy'
  const { inPortfolio, isLive } = ds
  const parts = []
  if (inPortfolio === true) parts.push('In portfolio')
  else if (inPortfolio === false) parts.push('Not in portfolio')
  if (isLive === true) parts.push('Live')
  else if (isLive === false) parts.push('Not live')
  return parts.length ? parts.join(' · ') : 'Deploy'
}

// ── Selection bar ──────────────────────────────────
function updateSelectionBar() {
  const bar = document.getElementById('selection-bar')
  const count = document.getElementById('sel-count')
  const goBtn = document.getElementById('enrich-go-btn')
  const allBtn = document.getElementById('sel-all-btn')
  const grid = document.getElementById('app-grid')

  const n = selected.size
  if (n === 0) {
    bar.classList.add('hidden')
    document.getElementById('enrich-panel').classList.add('hidden')
  } else {
    bar.classList.remove('hidden')
    count.textContent = `${n} selected`
    if (goBtn) goBtn.textContent = `Enrich ${n} app${n > 1 ? 's' : ''}`
    if (allBtn) allBtn.textContent = n === apps.length ? 'Deselect All' : 'Select All'
  }
  grid?.classList.toggle('selection-mode', n > 0)
}

function toggleSelect(appId) {
  if (selected.has(appId)) selected.delete(appId)
  else selected.add(appId)
  // Update just the card, not the whole library
  const card = document.querySelector(`.app-card[data-id="${appId}"]`)
  if (card) {
    const cb = card.querySelector('.card-cb')
    const isNowSelected = selected.has(appId)
    card.classList.toggle('selected', isNowSelected)
    if (cb) cb.classList.toggle('checked', isNowSelected)
  }
  updateSelectionBar()
}

function selectAll() {
  if (selected.size === apps.length) {
    selected.clear()
  } else {
    apps.forEach(a => selected.add(a.id))
  }
  renderLibrary()
  updateSelectionBar()
}

function selectNone() {
  selected.clear()
  renderLibrary()
  updateSelectionBar()
}

// ── Library ────────────────────────────────────────
function renderLibrary() {
  const container = document.getElementById('app-grid')
  const empty = document.getElementById('empty-state')
  container.innerHTML = ''

  if (!apps.length && !groups.length) {
    empty.classList.remove('hidden'); return
  }
  empty.classList.add('hidden')

  const q = searchQuery.toLowerCase()
  const visibleApps = q ? apps.filter(a => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)) : apps

  container.classList.toggle('selection-mode', selected.size > 0)

  if (viewMode === 'list') {
    const sorted = [...visibleApps].sort((a, b) => a.name.localeCompare(b.name))
    const table = document.createElement('div')
    table.className = 'app-table'
    table.innerHTML = `<div class="app-table-header"><span>Name</span><span>Category</span><span>Description</span><span></span></div>`
    for (const app of sorted) table.appendChild(makeAppRow(app))
    container.appendChild(table)
    return
  }

  const byGroup = {}
  const ungrouped = []
  for (const app of visibleApps) {
    if (app.groupId) {
      if (!byGroup[app.groupId]) byGroup[app.groupId] = []
      byGroup[app.groupId].push(app)
    } else ungrouped.push(app)
  }

  for (const group of groups) container.appendChild(makeGroupSection(group, byGroup[group.id] || []))
  if (ungrouped.length || !groups.length) container.appendChild(makeGroupSection(null, ungrouped))
}

function makeGroupSection(group, sectionApps) {
  const section = document.createElement('div')
  section.className = 'group-section'
  section.dataset.groupId = group?.id || '__ungrouped__'

  const color = group?.color || '#3a4a5a'
  const name = group?.name || 'Ungrouped'

  // Header
  const header = document.createElement('div')
  header.className = 'group-header'
  header.innerHTML = `<div class="group-bar" style="background:${color}"></div>`

  if (group) {
    const nameEl = document.createElement('span')
    nameEl.className = 'group-name'
    nameEl.contentEditable = 'true'
    nameEl.textContent = name
    nameEl.title = 'Click to rename'
    nameEl.addEventListener('focus', () => selectAll2(nameEl))
    nameEl.addEventListener('blur', async () => {
      const v = nameEl.textContent.trim() || name
      nameEl.textContent = v
      if (v !== group.name) { group.name = v; await window.api.updateGroup({ id: group.id, name: v }) }
    })
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur() }
      if (e.key === 'Escape') { nameEl.textContent = group.name; nameEl.blur() }
    })
    header.appendChild(nameEl)
    const spacer = document.createElement('div'); spacer.className = 'group-spacer'; header.appendChild(spacer)
    if (sectionApps.length) {
      const badge = document.createElement('span'); badge.className = 'group-count'; badge.textContent = sectionApps.length; header.appendChild(badge)
    }
    const del = document.createElement('button')
    del.className = 'group-del-btn'; del.title = 'Delete group'; del.textContent = '×'
    del.addEventListener('click', () => deleteGroup(group.id))
    header.appendChild(del)
  } else {
    const nameEl = document.createElement('span'); nameEl.className = 'group-name-static'; nameEl.textContent = name; header.appendChild(nameEl)
    const spacer = document.createElement('div'); spacer.className = 'group-spacer'; header.appendChild(spacer)
    if (sectionApps.length) {
      const badge = document.createElement('span'); badge.className = 'group-count'; badge.textContent = sectionApps.length; header.appendChild(badge)
    }
  }
  section.appendChild(header)

  // Grid or list
  const grid = document.createElement('div')
  grid.className = (viewMode === 'list' ? 'group-list' : 'group-grid') + ' drop-zone'
  grid.dataset.groupId = group?.id || '__ungrouped__'

  if (!sectionApps.length) {
    const hint = document.createElement('div'); hint.className = 'group-empty-hint'
    hint.textContent = group ? 'Drag apps here' : 'Drop folders to add'
    grid.appendChild(hint)
  }
  for (const app of sectionApps) grid.appendChild(viewMode === 'list' ? makeAppRow(app) : makeAppCard(app))

  grid.addEventListener('dragover', e => { e.preventDefault(); grid.classList.add('drag-over') })
  grid.addEventListener('dragleave', e => { if (!grid.contains(e.relatedTarget)) grid.classList.remove('drag-over') })
  grid.addEventListener('drop', async e => {
    e.preventDefault(); grid.classList.remove('drag-over')
    const appId = e.dataTransfer.getData('appId')
    if (!appId) return
    const tgt = group?.id || null
    const app = apps.find(a => a.id === appId)
    if (!app || app.groupId === tgt) return
    app.groupId = tgt
    await window.api.moveApp({ appId, groupId: tgt })
    renderLibrary()
  })

  section.appendChild(grid)
  return section
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function makeAppCard(app) {
  const [dark, light] = palette(app.name)
  const card = document.createElement('div')
  card.className = 'app-card' + (selected.has(app.id) ? ' selected' : '')
  card.dataset.id = app.id
  card.draggable = true

  const isEnriching = enriching.has(app.id)
  const inPortfolio = portfolioIds.has(slugify(app.name))

  card.innerHTML = `
    <div class="card-cb ${selected.has(app.id) ? 'checked' : ''}">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <polyline points="1.5,6 5,9.5 10.5,2.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    ${isEnriching ? `<div class="enrich-overlay show"><span class="enrich-spin">⏳</span></div>` : '<div class="enrich-overlay"></div>'}
    <div class="app-card-icon" style="background:linear-gradient(135deg,${light},${dark})">
      <img src="${appIcon(app)}" onerror="this.style.display='none'">
    </div>
    <div class="app-card-name">${esc(app.name)}</div>
    ${app.githubUrl ? `<button class="app-card-github" data-url="${esc(app.githubUrl)}" title="${esc(app.githubUrl)}">⎋ GitHub ↗</button>` : ''}
    <div class="app-card-quick">
      <button class="btn btn-success btn-run" title="Run">▶</button>
      <button class="btn ${deployBtnClass(app)} btn-deploy" title="${deployBtnTitle(app)}">${deployBtnIcon(app)}</button>
      <button class="btn btn-portfolio ${inPortfolio ? 'portfolio-in' : 'portfolio-out'}" title="${inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}">+</button>
      <button class="btn btn-terminal" title="Open terminal here">⌨</button>
    </div>`

  card.querySelector('.card-cb').addEventListener('click', e => { e.stopPropagation(); toggleSelect(app.id) })
  card.querySelector('.btn-run').addEventListener('click', e => { e.stopPropagation(); doRun(app.id) })
  card.querySelector('.btn-deploy').addEventListener('click', e => { e.stopPropagation(); doDeploy(app.id) })
  card.querySelector('.btn-portfolio').addEventListener('click', async e => {
    e.stopPropagation()
    const result = await window.api.togglePortfolioProject(app)
    if (result.notConfigured) { toast('Set your portfolio JSON file path first', 'error'); openPortfolio(); return }
    if (result.error) { toast(result.error, 'error'); return }
    if (result.inPortfolio) {
      portfolioIds.add(slugify(app.name))
    } else {
      portfolioIds.delete(slugify(app.name))
    }
    const btn = card.querySelector('.btn-portfolio')
    btn.classList.toggle('portfolio-in', result.inPortfolio)
    btn.classList.toggle('portfolio-out', !result.inPortfolio)
    btn.title = result.inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'
  })
  card.querySelector('.btn-terminal').addEventListener('click', e => { e.stopPropagation(); window.api.openTerminal(app.path) })
  card.querySelector('.app-card-github')?.addEventListener('click', e => { e.stopPropagation(); window.api.openExternal(app.githubUrl) })
  card.addEventListener('click', () => showDetail(app))
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('appId', app.id)
    e.dataTransfer.effectAllowed = 'move'
    setTimeout(() => card.classList.add('dragging'), 0)
  })
  card.addEventListener('dragend', () => card.classList.remove('dragging'))
  return card
}

function makeAppRow(app) {
  const [dark, light] = palette(app.name)
  const inPortfolio = portfolioIds.has(slugify(app.name))
  const isEnriching = enriching.has(app.id)
  const row = document.createElement('div')
  row.className = 'app-row' + (selected.has(app.id) ? ' selected' : '')
  row.dataset.id = app.id
  row.draggable = true
  row.innerHTML = `
    ${isEnriching ? `<div class="enrich-overlay show"><span class="enrich-spin" style="font-size:11px;color:#aaa">…</span></div>` : '<div class="enrich-overlay"></div>'}
    <div class="app-row-name-cell">
      <div class="app-row-icon" style="background:linear-gradient(135deg,${light},${dark})">
        <img src="${appIcon(app)}" onerror="this.style.display='none'">
      </div>
      <span class="app-row-name">${esc(app.name)}</span>
    </div>
    <div class="app-row-category-cell">${app.category ? `<span class="app-row-category">${esc(app.category)}</span>` : ''}</div>
    <div class="app-row-desc">${esc(app.description || '')}</div>
    <div class="app-card-quick">
      <button class="btn btn-success btn-run" title="Run">▶</button>
      <button class="btn ${deployBtnClass(app)} btn-deploy" title="${deployBtnTitle(app)}">${deployBtnIcon(app)}</button>
      <button class="btn btn-terminal" title="Open terminal here">⌨</button>
      ${app.githubUrl ? `<button class="btn btn-ghost btn-sm app-row-github" title="${esc(app.githubUrl)}">↗ GitHub</button>` : ''}
    </div>
  `
  row.querySelector('.btn-run').addEventListener('click', e => { e.stopPropagation(); doRun(app.id) })
  row.querySelector('.btn-deploy').addEventListener('click', e => { e.stopPropagation(); doDeploy(app.id) })
  row.querySelector('.btn-terminal').addEventListener('click', e => { e.stopPropagation(); window.api.openTerminal(app.path) })
  row.querySelector('.app-row-github')?.addEventListener('click', e => { e.stopPropagation(); window.api.openExternal(app.githubUrl) })
  row.addEventListener('click', () => showDetail(app))
  row.addEventListener('dragstart', e => {
    e.dataTransfer.setData('appId', app.id)
    e.dataTransfer.effectAllowed = 'move'
    setTimeout(() => row.classList.add('dragging'), 0)
  })
  row.addEventListener('dragend', () => row.classList.remove('dragging'))
  return row
}

// ── Card enrich state ──────────────────────────────
const STEP_LABELS = { reading: 'Reading…', description: 'Description…', category: 'Category…', runCommand: 'Run cmd…', githubUrl: 'GitHub…' }

function setCardEnrichState(appId, status, msg) {
  const card = document.querySelector(`.app-card[data-id="${appId}"], .app-row[data-id="${appId}"]`)
  if (!card) return
  const overlay = card.querySelector('.enrich-overlay')
  if (!overlay) return
  if (status === 'processing' || status === 'step') {
    const label = STEP_LABELS[msg] || '…'
    overlay.className = 'enrich-overlay show'
    overlay.innerHTML = `<span class="enrich-spin" style="font-size:11px;color:#aaa">${label}</span>`
  } else if (status === 'done') {
    overlay.className = 'enrich-overlay show'
    overlay.innerHTML = '<span style="color:#4fa32b;font-size:20px">✓</span>'
    setTimeout(() => overlay.classList.remove('show'), 2000)
  } else if (status === 'error') {
    overlay.className = 'enrich-overlay show'
    overlay.innerHTML = `<span style="color:#c6453a;font-size:18px" title="${esc(msg||'')}">✗</span>`
    setTimeout(() => overlay.classList.remove('show'), 4000)
  }
}

// ── Groups ─────────────────────────────────────────
async function addGroup() {
  const group = await window.api.addGroup('New Group')
  groups.push(group)
  renderLibrary()
  setTimeout(() => {
    const sections = document.querySelectorAll('.group-section')
    const hasUngrouped = apps.some(a => !a.groupId)
    const targetSection = sections[sections.length - (hasUngrouped ? 2 : 1)]
    const el = targetSection?.querySelector('.group-name')
    if (el) { el.focus(); selectAll2(el) }
  }, 30)
}

async function deleteGroup(groupId) {
  if (!confirm('Delete this group? Apps will move to Ungrouped.')) return
  await window.api.deleteGroup(groupId)
  groups = groups.filter(g => g.id !== groupId)
  apps = apps.map(a => a.groupId === groupId ? { ...a, groupId: null } : a)
  renderLibrary()
  toast('Group deleted', 'success')
}

function selectAll2(el) {
  const r = document.createRange(); r.selectNodeContents(el)
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
}

// ── Detail view ────────────────────────────────────
function showDetail(app) {
  current = { ...app }; slideIdx = 0
  document.getElementById('library-view').classList.remove('active')
  document.getElementById('detail-view').classList.add('active')
  document.getElementById('detail-app-name').textContent = app.name
  renderDetail()
}

function renderDetail() {
  const app = current
  const [dark, light] = palette(app.name)
  const slides = app.screenshots || []

  // Carousel
  let carouselHTML
  if (slides.length) {
    const slideEls = slides.map(s => `<div class="carousel-slide"><img src="file://${s}" onerror="this.style.display='none'"></div>`).join('')
    const dots = slides.length > 1 ? slides.map((_, i) => `<div class="cdot${i===0?' on':''}" data-i="${i}"></div>`).join('') : ''
    const nav = slides.length > 1 ? `<button class="carousel-nav prev">&#8249;</button><button class="carousel-nav next">&#8250;</button>` : ''
    carouselHTML = `<div class="carousel-wrap"><div class="carousel-inner" id="carousel-inner">${slideEls}</div>${nav}${dots ? `<div class="carousel-dots" id="carousel-dots">${dots}</div>` : ''}</div>`
  } else {
    carouselHTML = `<div class="carousel-wrap"><div class="carousel-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <span>No screenshots — add images to a <code>screenshots/</code> folder</span>
    </div></div>`
  }

  // Run commands in sidebar
  let runSidebarHTML
  if (app.runCommands?.length) {
    runSidebarHTML = app.runCommands.map((rc, i) =>
      `<button class="sidebar-btn sb-run ${i > 0 ? 'sb-run-sm' : ''}" data-cmd="${esc(rc.command)}" data-path="${esc(app.path)}">▶&nbsp; ${esc(rc.name)}</button>`
    ).join('')
  } else {
    runSidebarHTML = `<button class="sidebar-btn sb-run" id="sb-run">▶&nbsp; Run</button>`
  }

  // Sub-apps section
  let subAppsHTML = ''
  if (app.subApps?.length) {
    subAppsHTML = `<div class="section-sep"></div><div class="section-title">Sub-apps</div>
      ${app.subApps.map(sa => `
        <div class="sub-app-row">
          <div class="sub-app-info">
            <span class="sub-app-name">${esc(sa.name)}</span>
            <span class="sub-app-path">${esc(sa.relPath)}</span>
          </div>
          <button class="btn btn-success btn-xs sub-app-run" data-cmd="${esc(sa.runCommand)}" data-rpath="${esc(sa.relPath)}">▶</button>
        </div>`).join('')}`
  }

  // Group options
  const groupOpts = groups.map(g =>
    `<option value="${g.id}" ${app.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`
  ).join('')

  document.getElementById('detail-content').innerHTML = `
    ${carouselHTML}
    <div class="detail-body">
      <div class="detail-main">
        <div class="dapp-header">
          <div class="dapp-icon" style="background:linear-gradient(135deg,${light},${dark})">
            <img src="${appIcon(app)}" onerror="this.style.display='none'">
          </div>
          <div class="dapp-meta">
            <h3>${esc(app.name)}</h3>
            <div class="dapp-path">${esc(app.path)}</div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-group" style="flex:1">
            <label class="field-label">Group</label>
            <select class="field-input" id="f-group">
              <option value="">— Ungrouped —</option>${groupOpts}
            </select>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">GitHub URL</label>
          <div class="github-row">
            <input class="field-input mono" id="f-github" type="text" value="${esc(app.githubUrl || '')}" placeholder="https://github.com/user/repo">
            <button class="btn btn-ghost btn-icon" id="github-open-btn" title="Open in browser" ${app.githubUrl ? '' : 'disabled'}>↗</button>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Description</label>
          <textarea class="field-input desc-input" id="f-desc" placeholder="Describe this project...">${esc(app.description || '')}</textarea>
        </div>

        <div class="section-sep"></div>
        <div class="section-title">Run</div>
        <div class="field-group">
          <label class="field-label">Primary Run Command</label>
          <input class="field-input mono" id="f-run" type="text" value="${esc(app.runCommand || '')}" placeholder="npm start  /  python main.py  /  cargo run">
        </div>
        ${app.runCommands?.length ? `
        <div class="field-group">
          <label class="field-label">All detected commands</label>
          <div class="run-cmds-list">
            ${app.runCommands.map(rc => `
              <div class="run-cmd-item">
                <span class="run-cmd-name">${esc(rc.name)}</span>
                <code class="run-cmd-val">${esc(rc.command)}</code>
                <button class="btn btn-success btn-xs" data-cmd="${esc(rc.command)}" data-path="${esc(app.path)}">▶</button>
              </div>`).join('')}
          </div>
        </div>` : ''}

        ${subAppsHTML}

        <div class="section-sep"></div>
        <div class="section-title">Deploy</div>
        <div class="field-group">
          <label class="field-label">App Deploy Command <span style="color:var(--text3);font-size:10px;text-transform:none;letter-spacing:0">(optional pre-deploy step)</span></label>
          <input class="field-input mono" id="f-deploy" type="text" value="${esc(app.deployCommand || '')}" placeholder="vercel --prod  /  npm run deploy">
        </div>
        <div style="height:24px"></div>
      </div>

      <div class="detail-sidebar">
        ${runSidebarHTML}
        <button class="sidebar-btn sb-deploy ${deployBtnClass(app)}" id="sb-deploy">${deployBtnIcon(app)}&nbsp; Deploy</button>
        ${renderDeployStatusLine(app)}
        ${app.liveUrl ? `<div class="sb-live-url-row"><span class="dot-ok">●</span> <a id="sb-live-url" href="#" onclick="window.api.openExternal('${esc(app.liveUrl)}');return false" style="color:var(--accent);font-size:11px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:200px;display:inline-block">${esc(app.liveUrl)}</a></div>` : `<div class="sb-live-url-row" style="display:none"><span class="dot-ok">●</span> <span id="sb-live-url" style="color:var(--accent);font-size:11px"></span></div>`}
        <div class="sb-sep"></div>
        <div class="field-label" style="margin-bottom:0">Deploy Log</div>
        <div class="status-log" id="status-log"></div>
        <button class="sidebar-btn sb-delete" id="sb-delete">Remove from AppShelf</button>
      </div>
    </div>`

  // Carousel events
  if (slides.length > 1) {
    document.querySelector('.carousel-nav.prev').addEventListener('click', () => slide(-1))
    document.querySelector('.carousel-nav.next').addEventListener('click', () => slide(1))
    document.getElementById('carousel-dots').addEventListener('click', e => {
      if (e.target.dataset.i !== undefined) goSlide(+e.target.dataset.i)
    })
  }

  // Sidebar events
  document.querySelectorAll('.sb-run, [data-cmd]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      const cmd = btn.dataset.cmd
      const rpath = btn.dataset.rpath
      if (cmd) {
        let folderPath = current.path
        if (rpath) folderPath = current.path + '/' + rpath
        toast('Launching…', 'info')
        const r = await window.api.runCommandIn({ folderPath, command: cmd })
        if (r?.error) toast(r.error, 'error')
        else toast('Launched ✓', 'success')
      } else if (btn.id === 'sb-run') {
        saveFieldsNow(); doRun(current.id)
      }
    })
  })
  document.getElementById('sb-deploy')?.addEventListener('click', () => { saveFieldsNow(); doDeploy(current.id) })
  document.getElementById('sb-delete')?.addEventListener('click', deleteCurrentApp)

  document.getElementById('hdr-run-btn').addEventListener('click', () => { if (current) { saveFieldsNow(); doRun(current.id) } })
  const hdrDeploy = document.getElementById('hdr-deploy-btn')
  if (hdrDeploy) {
    hdrDeploy.className = `btn ${deployBtnClass(app)} no-drag`
    hdrDeploy.textContent = `${deployBtnIcon(app)} Deploy`
    hdrDeploy.title = deployBtnTitle(app)
    hdrDeploy.addEventListener('click', () => { if (current) { saveFieldsNow(); doDeploy(current.id) } })
  }

  // Group select
  document.getElementById('f-group')?.addEventListener('change', async e => {
    current.groupId = e.target.value || null
    await window.api.moveApp({ appId: current.id, groupId: current.groupId })
    const i = apps.findIndex(a => a.id === current.id)
    if (i !== -1) apps[i].groupId = current.groupId
  })

  // GitHub field
  const githubInput = document.getElementById('f-github')
  const githubOpenBtn = document.getElementById('github-open-btn')
  githubInput?.addEventListener('input', e => {
    if (githubOpenBtn) githubOpenBtn.disabled = !e.target.value.trim()
  })
  githubInput?.addEventListener('change', e => {
    current.githubUrl = e.target.value.trim()
    window.api.updateApp(current)
    const i = apps.findIndex(a => a.id === current.id)
    if (i !== -1) apps[i].githubUrl = current.githubUrl
  })
  githubOpenBtn?.addEventListener('click', () => {
    const url = document.getElementById('f-github')?.value.trim()
    if (url) window.api.openExternal(url)
  })

  // Auto-save config fields
  const fieldMap = {
    'f-desc': 'description', 'f-run': 'runCommand', 'f-deploy': 'deployCommand',
  }
  for (const [id, key] of Object.entries(fieldMap)) {
    document.getElementById(id)?.addEventListener('change', e => {
      current[key] = e.target.value
      window.api.updateApp(current)
      const i = apps.findIndex(a => a.id === current.id)
      if (i !== -1) apps[i] = { ...apps[i], [key]: e.target.value }
    })
  }
}

function saveFieldsNow() {
  if (!current) return
  const fieldMap = {
    'f-desc': 'description', 'f-run': 'runCommand', 'f-deploy': 'deployCommand',
  }
  for (const [id, key] of Object.entries(fieldMap)) {
    const el = document.getElementById(id); if (el) current[key] = el.value
  }
  window.api.updateApp(current)
}

// ── Carousel ───────────────────────────────────────
function slide(dir) {
  const len = current?.screenshots?.length || 0; if (!len) return
  goSlide((slideIdx + dir + len) % len)
}
function goSlide(i) {
  slideIdx = i
  const inner = document.getElementById('carousel-inner')
  if (inner) inner.style.transform = `translateX(-${i * 100}%)`
  document.querySelectorAll('.cdot').forEach((d, j) => d.classList.toggle('on', j === i))
}

// ── Run & Deploy ───────────────────────────────────
async function doRun(appId) {
  toast('Launching…', 'info')
  const r = await window.api.runApp(appId)
  if (r.error) toast(r.error, 'error')
  else toast('Launched ✓', 'success')
}

async function doDeploy(appId) {
  const btn = document.getElementById('sb-deploy')
  const hBtn = document.getElementById('hdr-deploy-btn')
  if (btn) btn.disabled = true
  if (hBtn) hBtn.disabled = true
  setLog('Deploying…')
  const r = await window.api.deployApp(appId)
  if (btn) btn.disabled = false
  if (hBtn) hBtn.disabled = false
  if (r.error) { setLog(`Error: ${r.error}`, 'error'); toast('Deploy failed', 'error'); return }
  let log = ''
  for (const s of r.steps || []) {
    const label = {
      'provision-do': 'DigitalOcean deploy',
      'deploy-app': 'App deploy',
      'update-portfolio': 'Portfolio update',
      'deploy-portfolio': 'Portfolio deploy'
    }[s.step] || s.step
    if (s.result.skipped) log += `<span class="skip">⊘ ${label}: skipped</span>\n`
    else if (s.result.error) log += `<span class="err">✗ ${label}: ${s.result.error}</span>\n`
    else {
      log += `<span class="ok">✓ ${label}</span>\n`
      if (s.result.liveUrl) log += `  → <a href="#" onclick="window.api.openExternal('${s.result.liveUrl}');return false" style="color:var(--accent)">${s.result.liveUrl}</a>\n`
      if (s.result.stdout?.trim()) log += s.result.stdout.trim() + '\n'
    }
  }
  // Update app's liveUrl in local state
  const provStep = r.steps?.find(s => s.step === 'provision-do' && s.result.liveUrl)
  if (provStep && current) {
    current.liveUrl = provStep.result.liveUrl
    const i = apps.findIndex(a => a.id === current.id)
    if (i !== -1) apps[i].liveUrl = current.liveUrl
    // Refresh live URL field in sidebar if present
    const liveUrlEl = document.getElementById('sb-live-url')
    if (liveUrlEl) { liveUrlEl.textContent = current.liveUrl; liveUrlEl.style.display = '' }
  }
  setLog(log.trim(), 'html')
  toast(r.success ? 'Deploy complete ✓' : 'Deploy finished with errors', r.success ? 'success' : 'error')
}

function setLog(text, mode) {
  const el = document.getElementById('status-log'); if (!el) return
  el.classList.add('show')
  if (mode === 'html') el.innerHTML = text
  else el.textContent = text
}

// ── Delete ─────────────────────────────────────────
async function deleteCurrentApp() {
  if (!current) return
  if (!confirm(`Remove "${current.name}" from AppShelf?\n(Does not delete your files.)`)) return
  await window.api.deleteApp(current.id)
  apps = apps.filter(a => a.id !== current.id)
  current = null; goBack(); renderLibrary()
  toast('Removed', 'success')
}

// ── Navigation ─────────────────────────────────────
function goBack() {
  saveFieldsNow()
  document.getElementById('detail-view').classList.remove('active')
  document.getElementById('library-view').classList.add('active')
  current = null
}

// ── Folder ingestion ───────────────────────────────
async function addFolders(folderPaths) {
  const results = await window.api.addApps(folderPaths)
  const added = results.filter(r => !r.error)
  const errors = results.filter(r => r.error)
  if (errors.length) toast(`${errors.length} skipped (already added)`, 'error')
  if (!added.length) return
  showAddAppsModal(added)
}

let folderBrowserParent = null

async function openFolderBrowser() {
  const homeDir = await window.api.getHomeDir()
  showFolderBrowserModal(homeDir)
}

async function showFolderBrowserModal(dirPath) {
  const modal = document.getElementById('folder-browser-modal')
  modal.classList.remove('hidden')

  await navigateFolderBrowser(dirPath)

  const submit = document.getElementById('folder-browser-submit')
  const cancel = document.getElementById('folder-browser-cancel')
  const closeBtn = document.getElementById('folder-browser-close')
  const backdrop = document.getElementById('folder-browser-backdrop')
  const upBtn = document.getElementById('folder-browser-up')

  function cleanup() {
    modal.classList.add('hidden')
    submit.removeEventListener('click', doSubmit)
    cancel.removeEventListener('click', doClose)
    closeBtn.removeEventListener('click', doClose)
    backdrop.removeEventListener('click', doClose)
    upBtn.removeEventListener('click', doUp)
  }

  async function doSubmit() {
    const list = document.getElementById('folder-browser-list')
    const checked = [...list.querySelectorAll('input[type="checkbox"]:checked')]
    const paths = checked.map(cb => cb.value)
    cleanup()
    if (paths.length) addFolders(paths)
  }

  async function doUp() {
    if (folderBrowserParent) await navigateFolderBrowser(folderBrowserParent)
  }

  function doClose() { cleanup() }

  submit.addEventListener('click', doSubmit)
  cancel.addEventListener('click', doClose)
  closeBtn.addEventListener('click', doClose)
  backdrop.addEventListener('click', doClose)
  upBtn.addEventListener('click', doUp)
}

async function navigateFolderBrowser(dirPath) {
  const result = await window.api.listSubdirs(dirPath)
  folderBrowserParent = result.parent

  document.getElementById('folder-browser-path').textContent = result.path
  document.getElementById('folder-browser-up').disabled = !result.parent

  const addedPaths = new Set(apps.map(a => a.path))
  const list = document.getElementById('folder-browser-list')
  list.innerHTML = ''

  const available = result.dirs.filter(d => !addedPaths.has(d.path) && !ignoredPaths.has(d.path))

  if (!available.length) {
    const empty = document.createElement('div')
    empty.className = 'folder-browser-empty'
    empty.textContent = result.dirs.length ? 'All folders here are already added.' : 'No folders here.'
    list.appendChild(empty)
    return
  }

  for (const dir of available) {
    const row = document.createElement('div')
    row.className = 'folder-browser-item'
    row.innerHTML = `
      <input type="checkbox" value="${esc(dir.path)}">
      <span class="folder-browser-item-name folder-browser-nav-link" data-path="${esc(dir.path)}">📁 ${esc(dir.name)}</span>
      <button class="folder-browser-ignore btn btn-ghost btn-sm" title="Ignore">✕</button>
    `
    list.appendChild(row)
  }

  list.querySelectorAll('.folder-browser-nav-link').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault()
      await navigateFolderBrowser(el.dataset.path)
    })
  })

  list.querySelectorAll('.folder-browser-ignore').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.folder-browser-item')
      const folderPath = row.querySelector('input[type="checkbox"]').value
      ignoredPaths.add(folderPath)
      await window.api.ignoreFolder(folderPath)
      row.remove()
    })
  })
}

function showAddAppsModal(added) {
  const title = document.getElementById('add-apps-title')
  title.textContent = added.length === 1 ? `Added "${added[0].name}"` : `Added ${added.length} apps`

  const list = document.getElementById('add-apps-list')
  list.innerHTML = ''
  for (const app of added) {
    const [dark, light] = palette(app.name)
    const initials = app.name.slice(0,2).toUpperCase()
    const row = document.createElement('div')
    row.className = 'add-app-row'
    row.dataset.id = app.id
    row.innerHTML = `
      <div class="add-app-icon" style="background:linear-gradient(135deg,${light},${dark})">${initials}</div>
      <div class="add-app-name">${esc(app.name)}</div>
      <select class="add-app-select">
        <option value="">No group</option>
        ${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}
      </select>
    `
    list.appendChild(row)
  }

  document.getElementById('add-apps-modal').classList.remove('hidden')

  const submit = document.getElementById('add-apps-submit')
  const cancel = document.getElementById('add-apps-cancel')

  const doSubmit = async () => {
    cleanup()
    const moves = []
    list.querySelectorAll('.add-app-row').forEach(row => {
      const groupId = row.querySelector('select').value || null
      const app = added.find(a => a.id === row.dataset.id)
      if (app) { app.groupId = groupId; moves.push({ appId: app.id, groupId }) }
    })
    await Promise.all(moves.map(m => window.api.moveApp(m)))
    for (const app of added) apps.push(app)
    renderLibrary()
    if (added.length === 1) showDetail(added[0])
    const appIds = added.map(a => a.id)
    for (const id of appIds) { enriching.add(id); setCardEnrichState(id, 'processing') }
    window.api.enrichApps({ appIds, options: { githubUrl: true } })
  }

  const doCancel = async () => {
    cleanup()
    // Remove the added apps since user cancelled
    await Promise.all(added.map(a => window.api.deleteApp(a.id)))
    document.getElementById('add-apps-modal').classList.add('hidden')
  }

  function cleanup() {
    document.getElementById('add-apps-modal').classList.add('hidden')
    submit.removeEventListener('click', doSubmit)
    cancel.removeEventListener('click', doCancel)
    document.getElementById('add-apps-close').removeEventListener('click', doCancel)
    document.getElementById('add-apps-backdrop').removeEventListener('click', doCancel)
  }

  submit.addEventListener('click', doSubmit)
  cancel.addEventListener('click', doCancel)
  document.getElementById('add-apps-close').addEventListener('click', doCancel)
  document.getElementById('add-apps-backdrop').addEventListener('click', doCancel)
}

// ── Portfolio modal ─────────────────────────────────
async function openPortfolio() {
  const portfolio = await window.api.getPortfolioSettings()
  document.getElementById('pf-file-path').value = portfolio.filePath || ''
  document.getElementById('portfolio-modal').classList.remove('hidden')
}

function closePortfolio() {
  document.getElementById('portfolio-modal').classList.add('hidden')
}

async function savePortfolioSettings() {
  const filePath = document.getElementById('pf-file-path').value.trim()
  const result = await window.api.savePortfolioSettings({ filePath })
  if (result.groups) {
    const added = result.groups.filter(g => !groups.find(eg => eg.id === g.id))
    if (added.length) {
      groups = result.groups
      renderLibrary()
      toast(`Portfolio saved · ${added.length} group${added.length > 1 ? 's' : ''} synced`, 'success')
      closePortfolio(); return
    }
  }
  closePortfolio()
  toast('Portfolio settings saved', 'success')
}

// ── Settings modal ─────────────────────────────────
async function openSettings() {
  const [s, providers] = await Promise.all([
    window.api.getSettings(),
    window.api.getProviderSettings()
  ])
  const input = document.getElementById('api-key-input')
  if (input) input.value = s.openaiApiKey || ''
  if (s.hasEnvKey && !s.openaiApiKey) input.placeholder = '(set via OPENAI_API_KEY env var)'

  // Populate DO fields
  const doConfig = providers.digitalocean || {}
  const doToken = document.getElementById('do-token')
  const doRegion = document.getElementById('do-region')
  const doSize = document.getElementById('do-size')
  const doBranch = document.getElementById('do-branch')
  if (doToken) doToken.value = doConfig.token || ''
  if (doRegion) doRegion.value = doConfig.region || 'nyc1'
  if (doSize) doSize.value = doConfig.size || 'basic-s'
  if (doBranch) doBranch.value = doConfig.branch || 'main'

  const badge = document.getElementById('do-badge')
  if (badge) badge.textContent = doConfig.token ? 'Configured' : ''
  const card = document.getElementById('provider-do')
  if (card) card.classList.toggle('configured', !!doConfig.token)

  document.getElementById('settings-modal').classList.remove('hidden')
}

function closeSettings() {
  document.getElementById('do-config-panel').classList.add('hidden')
  document.getElementById('settings-modal').classList.add('hidden')
}

// ── Enrich ─────────────────────────────────────────
async function startEnrich() {
  const options = {
    githubUrl: document.getElementById('opt-github').checked,
    runCommands: document.getElementById('opt-commands').checked,
    subApps: document.getElementById('opt-subapps').checked,
    deployCheck: document.getElementById('opt-deploy-check').checked,
  }
  if (!options.githubUrl && !options.runCommands && !options.subApps && !options.deployCheck) {
    toast('Select at least one enrichment option', 'error'); return
  }
  if (options.runCommands || options.subApps) {
    const s = await window.api.getSettings()
    if (!s.openaiApiKey && !s.hasEnvKey) {
      toast('Set your OpenAI API key in Settings first', 'error')
      document.getElementById('enrich-panel').classList.add('hidden')
      openSettings(); return
    }
  }

  const appIds = [...selected]
  document.getElementById('enrich-panel').classList.add('hidden')
  selected.clear(); updateSelectionBar(); renderLibrary()

  for (const id of appIds) { enriching.add(id); setCardEnrichState(id, 'processing') }
  toast(`Enriching ${appIds.length} app${appIds.length > 1 ? 's' : ''}…`, 'info')

  const r = await window.api.enrichApps({ appIds, options })
  if (r.error) toast(r.error, 'error')
}

// ── Toast ──────────────────────────────────────────
let _tt
function toast(msg, type = 'info') {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = `toast ${type}`
  clearTimeout(_tt); _tt = setTimeout(() => el.classList.add('hidden'), 3200)
}

// ── Helpers ────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Init ───────────────────────────────────────────
async function init() {
  const [data, ids] = await Promise.all([window.api.getData(), window.api.getPortfolioIds()])
  groups = data.groups || []; apps = data.apps || []; ignoredPaths = new Set(data.ignoredPaths || [])
  portfolioIds = new Set(ids)
  renderLibrary()

  // Library buttons
  const viewToggleBtn = document.getElementById('view-toggle-btn')
  viewToggleBtn.addEventListener('click', () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid'
    viewToggleBtn.textContent = viewMode === 'grid' ? '⊞' : '☰'
    renderLibrary()
  })

  document.getElementById('add-group-btn').addEventListener('click', addGroup)
  document.getElementById('add-app-btn').addEventListener('click', openFolderBrowser)
  document.getElementById('empty-add-btn').addEventListener('click', openFolderBrowser)
  document.getElementById('portfolio-btn').addEventListener('click', openPortfolio)
  document.getElementById('sync-portfolio-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-portfolio-btn')
    btn.disabled = true; btn.textContent = '↑ Syncing…'
    const r = await window.api.syncPortfolio()
    btn.disabled = false; btn.textContent = '↑ Sync'
    if (r.notConfigured) { toast('Set your portfolio JSON file path first', 'error'); openPortfolio(); return }
    if (r.error) { toast(r.error, 'error'); return }
    const parts = []
    if (r.added) parts.push(`${r.added} added`)
    if (r.updated) parts.push(`${r.updated} updated`)
    toast(parts.length ? `Portfolio synced: ${parts.join(', ')}` : 'Portfolio already up to date', 'success')
  })
  document.getElementById('settings-btn').addEventListener('click', openSettings)

  // Search
  const searchEl = document.getElementById('search-input')
  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value
    renderLibrary()
  })
  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchQuery = ''; searchEl.value = ''; searchEl.blur(); renderLibrary() }
  })
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      searchEl.focus()
      searchEl.select()
    }
  })

  // Selection bar
  document.getElementById('sel-all-btn').addEventListener('click', selectAll)
  document.getElementById('sel-none-btn').addEventListener('click', selectNone)
  document.getElementById('enrich-btn').addEventListener('click', () => {
    document.getElementById('enrich-panel').classList.toggle('hidden')
  })
  document.getElementById('enrich-go-btn').addEventListener('click', startEnrich)

  // Portfolio modal
  document.getElementById('portfolio-backdrop').addEventListener('click', closePortfolio)
  document.getElementById('portfolio-close').addEventListener('click', closePortfolio)
  document.getElementById('portfolio-cancel-btn').addEventListener('click', closePortfolio)
  document.getElementById('portfolio-save-btn').addEventListener('click', savePortfolioSettings)
  document.getElementById('pf-browse-btn').addEventListener('click', async () => {
    const p = await window.api.selectFile({ filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (p) document.getElementById('pf-file-path').value = p
  })

  // Settings modal
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings)
  document.getElementById('settings-close').addEventListener('click', closeSettings)
  document.getElementById('settings-cancel-btn').addEventListener('click', closeSettings)
  document.getElementById('settings-save-btn').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim()
    const existing = await window.api.getSettings()
    await window.api.saveSettings({ ...existing, openaiApiKey: key })
    closeSettings(); toast('Settings saved', 'success')
  })

  // Provider cards
  document.getElementById('provider-do')?.addEventListener('click', () => {
    const panel = document.getElementById('do-config-panel')
    const card = document.getElementById('provider-do')
    const isOpen = !panel.classList.contains('hidden')
    panel.classList.toggle('hidden', isOpen)
    card.classList.toggle('open', !isOpen)
  })
  document.getElementById('do-config-close')?.addEventListener('click', () => {
    document.getElementById('do-config-panel').classList.add('hidden')
    document.getElementById('provider-do').classList.remove('open')
  })
  document.getElementById('do-token-show')?.addEventListener('click', () => {
    const inp = document.getElementById('do-token')
    inp.type = inp.type === 'password' ? 'text' : 'password'
  })
  document.getElementById('do-save-btn')?.addEventListener('click', async () => {
    const token = document.getElementById('do-token').value.trim()
    const region = document.getElementById('do-region').value
    const size = document.getElementById('do-size').value
    const branch = document.getElementById('do-branch').value.trim() || 'main'
    const providers = await window.api.getProviderSettings()
    providers.digitalocean = { token, region, size, branch }
    await window.api.saveProviderSettings(providers)
    const badge = document.getElementById('do-badge')
    if (badge) badge.textContent = token ? 'Configured' : ''
    const card = document.getElementById('provider-do')
    if (card) card.classList.toggle('configured', !!token)
    document.getElementById('do-config-panel').classList.add('hidden')
    card.classList.remove('open')
    toast('DigitalOcean settings saved', 'success')
  })
  document.getElementById('do-clear-btn')?.addEventListener('click', async () => {
    document.getElementById('do-token').value = ''
    document.getElementById('do-branch').value = 'main'
    const providers = await window.api.getProviderSettings()
    delete providers.digitalocean
    await window.api.saveProviderSettings(providers)
    const badge = document.getElementById('do-badge')
    if (badge) badge.textContent = ''
    document.getElementById('provider-do').classList.remove('configured', 'open')
    document.getElementById('do-config-panel').classList.add('hidden')
    toast('DigitalOcean config cleared', 'info')
  })

  // Deploy progress events (from DO provisioning)
  window.api.onDeployProgress(({ appId, message }) => {
    const log = document.getElementById('status-log')
    if (log) {
      log.classList.add('show')
      log.textContent += (log.textContent ? '\n' : '') + message
      log.scrollTop = log.scrollHeight
    }
  })

  function liveLibrarySnapshot() {
    return {
      groups,
      apps,
      ignoredPaths: [...ignoredPaths]
    }
  }

  document.getElementById('export-btn').addEventListener('click', async () => {
    const r = await window.api.exportData(liveLibrarySnapshot())
    if (r.canceled) return
    if (r.error) { toast(r.error, 'error'); return }
    const n = r.appCount != null ? `${r.appCount} app${r.appCount !== 1 ? 's' : ''}` : 'Library'
    toast(`${n} exported → ${r.path.split('/').pop()}`, 'success')
  })

  document.getElementById('export-names-btn').addEventListener('click', async () => {
    const r = await window.api.exportNamesList(liveLibrarySnapshot())
    if (r.canceled) return
    if (r.error) { toast(r.error, 'error'); return }
    const n = r.count != null ? `${r.count} name${r.count !== 1 ? 's' : ''}` : 'Names'
    toast(`${n} → ${r.path.split('/').pop()}`, 'success')
  })

  document.getElementById('import-btn').addEventListener('click', async () => {
    const r = await window.api.importData()
    if (r.canceled) return
    if (r.error) { toast(r.error, 'error'); return }
    // Merge into live state
    groups = r.data.groups
    apps = r.data.apps
    renderLibrary()
    closeSettings()
    const msg = [
      r.addedApps && `${r.addedApps} app${r.addedApps > 1 ? 's' : ''} added`,
      r.skippedApps && `${r.skippedApps} already existed`,
      r.addedGroups && `${r.addedGroups} group${r.addedGroups > 1 ? 's' : ''} added`,
    ].filter(Boolean).join(', ')
    toast(msg || 'Nothing new to import', r.addedApps || r.addedGroups ? 'success' : 'info')
  })

  // Detail nav
  document.getElementById('back-btn').addEventListener('click', () => { goBack(); renderLibrary() })

  // Enrich progress events
  window.api.onEnrichProgress(({ appId, status, step, result, error }) => {
    if (status === 'step') {
      setCardEnrichState(appId, 'step', step)
      if (result) {
        const i = apps.findIndex(a => a.id === appId)
        if (i !== -1) apps[i] = result
      }
      return
    }
    enriching.delete(appId)
    if (status === 'done' && result) {
      const i = apps.findIndex(a => a.id === appId)
      if (i !== -1) apps[i] = result
      // Update card icon badge if github url was added
      const card = document.querySelector(`.app-card[data-id="${appId}"]`)
      if (card) {
        if (result.githubUrl && !card.querySelector('.app-card-github')) {
          const name = card.querySelector('.app-card-name')
          if (name) name.insertAdjacentHTML('afterend', `<div class="app-card-github">⎋ GitHub</div>`)
        }
        // Update deploy button status on card
        const deployBtn = card.querySelector('.app-card-quick .btn:last-child')
        if (deployBtn) {
          deployBtn.className = `btn ${deployBtnClass(result)}`
          deployBtn.textContent = deployBtnIcon(result)
          deployBtn.title = deployBtnTitle(result)
        }
      }
      setCardEnrichState(appId, 'done')
      toast(`✓ ${result.name} enriched`, 'success')
    } else if (status === 'error') {
      setCardEnrichState(appId, 'error', error)
      toast(`Enrichment error: ${error}`, 'error')
    }
  })

  // Window dragging via JS (avoids -webkit-app-region conflicts with buttons)
  document.querySelectorAll('.titlebar').forEach(titlebar => {
    titlebar.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      if (e.target.closest('button, input, select, a, [data-id]')) return
      let lastX = e.screenX, lastY = e.screenY
      const onMove = e => {
        window.api.moveWindow(e.screenX - lastX, e.screenY - lastY)
        lastX = e.screenX; lastY = e.screenY
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      e.preventDefault()
    })
  })

  // Drag & drop folders
  let dragDepth = 0
  const overlay = document.getElementById('drop-overlay')
  document.addEventListener('dragenter', e => {
    e.preventDefault(); dragDepth++
    if (document.getElementById('library-view').classList.contains('active')) overlay.classList.remove('hidden')
  })
  document.addEventListener('dragleave', () => {
    dragDepth--; if (dragDepth <= 0) { dragDepth = 0; overlay.classList.add('hidden') }
  })
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; overlay.classList.add('hidden')
    if (!document.getElementById('library-view').classList.contains('active')) return
    if (e.dataTransfer.getData('appId')) return // internal card drag
    const paths = []
    for (const item of [...(e.dataTransfer?.items || [])]) {
      if (item.kind === 'file') { const f = item.getAsFile(); if (f?.path) paths.push(f.path) }
    }
    if (!paths.length) for (const f of [...(e.dataTransfer?.files || [])]) { if (f.path) paths.push(f.path) }
    if (paths.length) addFolders(paths)
  })

  // Close enrich panel on outside click
  document.addEventListener('click', e => {
    const panel = document.getElementById('enrich-panel')
    const wrap = document.querySelector('.enrich-wrap')
    if (!panel.classList.contains('hidden') && !wrap?.contains(e.target)) {
      panel.classList.add('hidden')
    }
  })
}

init()
