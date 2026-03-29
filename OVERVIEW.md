# AppShelf

## Original Brief

> Make a very simple one-shot app where I should be able to just select folders or just drag folders in. What happens is that the folder becomes an app that has a nice icon and everything. When I click on it, it has a nice little page, as if it's like a steam page, where it shows the screenshots of the app and a description. I can click one click to run it, or I can click one click to deploy it. I can set the run command specifically for that app. I can also say where I want to deploy it or the deploy instructions.
>
> Mainly, we're going to be adding that into another app I have called a personal portfolio project. We're going to just basically deploy it and append it to the personal project in the section I'll tell you where all the apps are listed. That is not only deployed but added to the list in the personal project. I want all this automated. The user flow is:
> 1. Drag the app or the folder in there, or open the folder.
> 2. It creates the icon.
> 3. One click to deploy and add to the portfolio site, or one click to run.

---

## What Was Built

Electron desktop app (`npm start` to run).

### User Flow
1. Drag a folder onto the window, or click **+ Add Folder**
2. An entry is created with a generated gradient icon (auto-reads screenshots and README for description)
3. Click the entry to open its Steam-like detail page
4. **▶ Run** — opens Terminal.app at the folder and executes the run command
5. **⬆ Deploy** — runs three steps in sequence and shows a live log:
   - App deploy command (e.g. `vercel --prod`)
   - Injects a formatted entry into the portfolio file after a marker comment
   - Runs the portfolio's own deploy command

### Auto-detection
- Run command is guessed from `package.json` scripts, `Cargo.toml`, `main.py`, `main.go`, `Makefile`, etc.
- Screenshots pulled from `screenshots/`, `assets/images/`, or root image files
- Description extracted from the first paragraph of `README.md`

### Portfolio Integration Config (per app)
| Field | Purpose |
|---|---|
| Portfolio File Path | Absolute path to the file listing apps |
| Section Marker | Line after which the new entry is injected (e.g. `<!-- APPS_START -->`) |
| Entry Template | HTML/JSON/any format — supports `{{name}}` `{{description}}` `{{date}}` `{{runCommand}}` |
| Portfolio Deploy Command | Runs from the portfolio file's directory after injection |

### Files
```
appshelf/
├── main.js        — Electron main process, IPC handlers, file I/O, process execution
├── preload.js     — Secure context bridge (contextIsolation)
├── index.html     — App shell (library view + detail view)
├── styles.css     — Dark Steam-like theme
├── renderer.js    — All UI logic, carousel, drag-drop, deploy flow
└── package.json
```

App data is persisted to `~/Library/Application Support/appshelf/appshelf-apps.json`.

---

## Checkpoint 2 — Multi-folder support

Added ability to select or drop multiple folders at once.

**Changes:**
- `main.js` — dialog now uses `multiSelections`; replaced `add-app` IPC with `add-apps` which accepts an array of paths, processes all, saves in one write, and returns per-path results (skips duplicates without aborting the batch)
- `preload.js` — exposes `addApps(paths[])` instead of `addApp`
- `renderer.js` — `addFolders(paths[])` replaces `addFolder`; drop handler collects all dropped paths (no longer breaks after first); button handlers pass the full paths array from the dialog; toast shows count when multiple added, or opens detail view when exactly one added

---

---

## Checkpoint 3 — Visual grouping

Added drag-and-drop grouping system for organizing apps into named sections.

**Data model:** JSON file changed from flat array to `{ groups: [], apps: [] }` with auto-migration from old format. Each app gains a `groupId` field (null = ungrouped).

**New IPC handlers:** `get-data`, `add-group`, `update-group`, `delete-group`, `move-app`

**UI changes:**
- Library view renders apps in labeled group sections instead of a flat grid
- Each group has a color bar accent, inline-editable name (click to rename, Enter/Escape to confirm), app count badge, and a delete button (appears on hover)
- Drag any app card to a different group section to reassign it
- `+ Group` button in titlebar creates a group with auto-assigned color and immediately focuses the name for editing
- Detail view has a Group dropdown to reassign from the config panel
- Ungrouped apps always shown at the bottom in a static "Ungrouped" section
- Old flat folder drop-to-add still works; internal card drags are distinguished from folder drops

---

---

## Checkpoint 4 — Checkboxes, multi-select, and AI enrichment

Added per-app checkboxes, bulk selection, and one-click AI enrichment via the Anthropic Claude API.

**Selection UX:**
- Checkbox appears top-left of each card on hover; all checkboxes stay visible once any are checked ("selection mode")
- Selection bar appears below titlebar showing count + Select All / None buttons
- Selecting all: toggles between select-all and deselect-all

**Enrich button + dropdown panel:**
- ✦ Enrich button in selection bar opens a panel with three checkboxes:
  - GitHub URL — reads `.git/config` deterministically, no AI needed, converts SSH → HTTPS
  - Run Commands — AI scans `package.json`, `Makefile`, `Cargo.toml`, `Procfile`, `docker-compose`, etc. and returns all runnable commands
  - Sub-apps — AI identifies separate runnable services within the folder (monorepos, fullstack apps)
- Per-card overlay shows ⏳ while processing, ✓ on done, ✗ on error (real-time via IPC events)
- If AI options selected but no API key, prompts to open Settings first

**Settings modal (⚙ button in titlebar):**
- Password field for Anthropic API key
- Falls back to `ANTHROPIC_API_KEY` env var automatically
- Saved to `appshelf-settings.json` in Electron userData

**Enriched data stored per app:**
- `githubUrl` — shown in detail view as editable field with ↗ open link; badge on card
- `runCommands[]` — `{name, command}` list shown in detail sidebar as individual Run buttons and in a table in the main panel
- `subApps[]` — `{name, relPath, runCommand}` shown in detail main as a sub-apps section with per-service Run buttons
- Primary `runCommand` auto-populated from first detected command if not previously set

**New IPC handlers:** `get-settings`, `save-settings`, `enrich-apps`, `run-command-in`
**Progress:** main process sends `enrich-progress` events per-app as they complete

---

---

## Checkpoint 5 — Export & non-destructive import

Added JSON export and merge-import under ⚙ Settings → Data section.

**Export:** Saves the full `{ groups, apps }` payload to a user-chosen `.json` file via native save dialog. Filename defaults to `appshelf-YYYY-MM-DD.json`.

**Import (non-destructive merge):**
- Opens a JSON file (supports both new `{ groups, apps }` format and the old flat-array format)
- Groups merged by `id` — if a group with that id already exists it is skipped
- Apps merged by `path` — if an app at that path already exists it is skipped; nothing is overwritten
- If an imported app references a `groupId` that doesn't exist in the current data, it is ungrouped rather than lost
- After import, live state (`groups`, `apps`) is updated immediately and the library re-renders without a reload
- Toast summarises what was added vs skipped (e.g. "3 apps added, 2 already existed, 1 group added")

Both actions live in the ⚙ Settings modal under a "Data" section.

---

---

## Checkpoint 6 — Central portfolio config + deploy status

Removed per-app portfolio fields. All portfolio configuration is now centralized.

**Portfolio modal** (new "Portfolio" button in titlebar):
- Portfolio file path, live URL (with ↗ open), portfolio deploy command, entry template
- Category → Section Mappings table: one row per AppShelf group + a "Default / Ungrouped" row, each mapped to a section marker in the portfolio file. Apps get injected at the marker matching their group; falls back to the default mapping.

**Centralized deploy flow** (3 steps):
1. App's own `deployCommand` (optional, stays per-app — for pre-deploy build steps)
2. Inject entry into portfolio file at the group-matched marker using central template
3. Run central portfolio deploy command from the portfolio file's directory

**Deploy status check** (new enrich option: "Check Deployment Status"):
- Reads portfolio file, checks if app name appears → `inPortfolio: true/false/null`
- HTTP GETs the live URL, checks if app name appears in HTML → `isLive: true/false/null`
- Stored as `deployStatus: { inPortfolio, isLive, checkedAt }` per app
- Uses same enrich-progress event flow; works on multi-selected apps in batch

**Deploy button states** (card quick-action + detail sidebar):
- Both deployed → green ✓ button
- One of two → yellow ~ button
- Neither / unchecked → blue ⬆ button (original)
- All states clickable (redeploy on green/yellow)
- Status line below sidebar deploy button: "● In portfolio · ✗ Not live · checked Xm ago"

**Removed from individual app detail pages:** portfolioPath, portfolioMarker, portfolioTemplate, portfolioDeployCommand

---

## Checkpoint 9 — Packaged as macOS .app

Added `npm run build` which produces a standalone `AppShelf.app` in `dist/`.

- Installed `electron-packager` as devDependency
- Created `icons/icon.icns` — gradient blue/dark grid icon matching the app's visual identity, generated via `qlmanage` + `sips` + `iconutil` from SVG source
- Build script: `electron-packager . AppShelf --platform=darwin --arch=x64 --out=dist --overwrite --ignore dist --ignore .git --icon=icons/icon.icns`
- Added `.gitignore` excluding `node_modules/` and `dist/`
- Output: `dist/AppShelf-darwin-x64/AppShelf.app` (~242MB with Electron runtime bundled)

**To install:** drag `dist/AppShelf-darwin-x64/AppShelf.app` to `/Applications`, then it appears in Launchpad/App drawer and can be pinned to the Dock.

---

## Checkpoint 12 — Portfolio path config, search, auto GitHub enrich

**Portfolio modal simplified:**
- Removed live URL, deploy command, entry template, and category mapping fields
- Modal now only asks for the portfolio JSON file path (with a `…` browse button)
- `+` button on cards now checks if portfolio path is configured; if not, shows a toast and opens the modal automatically

**Portfolio JSON (`toggle-portfolio-project`):**
- Now reads path from portfolio settings instead of the old hardcoded PersonalTrailblazer path
- Adds `githubUrl` as an explicit field in the project entry alongside `url`
- Returns `{ notConfigured: true }` if no path set so the UI can prompt the user

**Search (press `/`):**
- Pressing `/` anywhere in the library focuses and animates in a search input in the titlebar
- Filters apps by name and description in real time
- `Escape` clears and collapses the input

**Auto GitHub enrichment on add:**
- When folders are added, GitHub URL enrichment runs automatically in the background
- Shows the same card processing overlay as manual enrich; updates detail view when done

**New IPC:** `select-file` (opens a file picker filtered to JSON) exposed via preload as `selectFile`

---

---

## Checkpoint 7 — Deployment providers (DigitalOcean live)

Added deployment provider system to Settings modal. DigitalOcean App Platform is fully functional; AWS, GCP, Vercel are UI placeholders.

**Settings modal additions:**
- Provider grid: 4 cards (DO active, others "Soon")
- DO card toggles a config panel below: API token (password + show/hide toggle), region dropdown (nyc1/nyc3/sfo3/ams3/sgp1/lon1/fra1/tor1), size dropdown (basic-xxs → basic-m, default basic-s), branch input
- "Configured" badge on DO card when token is saved; "Clear" button to remove config
- Saved under `settings.providers.digitalocean` in `appshelf-settings.json`

**New IPC handlers:** `get-provider-settings`, `save-provider-settings`
**New preload APIs:** `getProviderSettings`, `saveProviderSettings`, `onDeployProgress`

**DigitalOcean deploy flow (Step 0 in `deploy-app`):**
- Triggered when `!app_data.liveUrl` and `providers.digitalocean.token` exists
- `detectAppEnvironment` — detects node/python/go/rust/dockerfile from files
- `generateDOSpecYAML` — produces App Platform spec YAML (repo from githubUrl, branch, region, size, build/run commands per env)
- `execPromise` helper wraps child_process exec as a Promise
- `doctl apps create --spec <file>` — creates the app, captures DO app ID and initial live URL
- `waitForDODeployment` — polls `doctl apps list-deployments` every 15s until ACTIVE/ERROR (15 min timeout)
- Fetches live URL via `doctl apps get` if not returned at create time
- Sends real-time `deploy-progress` IPC events per step (shown in deploy log panel)
- On success: saves `liveUrl` to app data, shows clickable URL in sidebar and deploy log

**Portfolio template:** Added `{{liveUrl}}` placeholder support

**Detail sidebar:** Shows `liveUrl` as a clickable link row below deploy status when set; hidden span kept for post-deploy update without re-render

**Also committed:** git repo initialized (`git init`) and Checkpoints 1–6 committed before this session's work.

---

---

## Checkpoint 8 — JS window dragging, button reliability

Replaced `-webkit-app-region` CSS drag entirely with JavaScript window dragging to fix unreliable hover/click on titlebar buttons.

**Problem:** Electron's `-webkit-app-region: drag` on the titlebar caused macOS to intercept mouse events for buttons in the left/center area (+ Group, + Add Folder), making hover and click inconsistent. Portfolio and Settings (far right) were less affected. No amount of `no-drag` overrides or container wrappers fixed it reliably.

**Solution:**
- Removed all `-webkit-app-region` from titlebar and child elements
- `mousedown` on any titlebar area that isn't a `button/input/select/a` starts a drag — sends `dx/dy` deltas via IPC to `mainWindow.setPosition()` in main process
- New IPC: `move-window` (fire-and-forget `ipcRenderer.send`) + `ipcMain.on` handler
- New preload API: `moveWindow(dx, dy)`
- Wrapped library titlebar buttons in `.titlebar-actions` div; detail view back/run/deploy buttons similarly grouped
- `btn-ghost` hover now shows `var(--bg4)` background for clear visual feedback

 cp -R dist/AppShelf-darwin-x64/AppShelf.app /Applications/

claude --resume af6ec42c-2b61-46d8-8662-2c2c1cfc85ad

---

## Checkpoint 10 — Portfolio "+" button synced to PersonalTrailblazer

Added a "+" button to every app card (alongside Run ▶ and Deploy) that toggles the app in/out of the PersonalTrailblazer portfolio JSON.

**Files changed:**
- `main.js`: Added `TRAILBLAZER_PORTFOLIO` path constant pointing to `~/PersonalTrailblazer/client/src/data/portfolioData.json`. Added `get-portfolio-ids` IPC handler (returns all current project IDs) and `toggle-portfolio-project` handler (adds or removes the entry by slugified name, writing `{ id, name, description, url, category: "Productivity" }`).
- `preload.js`: Exposed `getPortfolioIds()` and `togglePortfolioProject(app)` via context bridge.
- `renderer.js`: Added `portfolioIds` Set to state; loaded on init alongside app data. Added `slugify()` helper. Updated `makeAppCard` to render a `+` button with class `portfolio-in` (green) or `portfolio-out` (blue) based on whether the app's slugified name exists in `portfolioIds`. Click handler calls `togglePortfolioProject`, updates the set, and flips the button color in-place without re-rendering.
- `styles.css`: Added `.portfolio-in` (green) and `.portfolio-out` (blue) button styles.
