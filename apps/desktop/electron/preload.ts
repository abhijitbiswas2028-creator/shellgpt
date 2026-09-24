import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import type { DesktopProfileRoute } from './desktop-profile'
import type { HudModifierApi, HudModifierStatus } from './hud-modifier-types'
import { customWindowControlsEnabled } from './window-controls'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.shellgptDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('shellgpt:translucency:support')
const hudWindowing = ipcRenderer.sendSync('shellgpt:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true
const launchFlags = ipcRenderer.sendSync('shellgpt:launch-flags')
// Local, sanitized skin payload for the first renderer theme paint. This does
// not wait on `gateway.ready`, so an unreachable remote primary cannot force
// the built-in palette over the skin configured on this machine.
const localSkin = ipcRenderer.sendSync('shellgpt:skin:local')

contextBridge.exposeInMainWorld('shellgptDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  // Launch-flag fact: the Nous free tier is on for this launch
  // (SHELLGPT_GUEST_ONBOARDING=1 or --guest-onboarding). Read-only; the same
  // decision is stamped onto every backend the app spawns.
  guestOnboardingEnabled: launchFlags?.guestOnboarding === true,
  localSkin: localSkin && typeof localSkin === 'object' ? localSkin : null,
  // Launch-flag fact: skip the first-run film (SHELLGPT_SKIP_INTRO=1 or
  // --skip-intro). Rehearsal aid for the guided chat behind it.
  skipIntro: launchFlags?.skipIntro === true,
  getConnection: (profile, opts) => ipcRenderer.invoke('shellgpt:connection', profile, opts),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('shellgpt:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('shellgpt:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('shellgpt:connection:revalidate'),
  touchBackend: (profile, options) => ipcRenderer.invoke('shellgpt:backend:touch', profile, options),
  getPoolLimits: () => ipcRenderer.invoke('shellgpt:pool-limits:get'),
  setPoolLimits: limits => ipcRenderer.invoke('shellgpt:pool-limits:set', limits),
  getGatewayWsUrl: profile => ipcRenderer.invoke('shellgpt:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('shellgpt:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('shellgpt:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('shellgpt:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('shellgpt:window:openInTerminal', sessionId, opts),
  openWindow: (options?: DesktopProfileRoute) => ipcRenderer.invoke('shellgpt:window:openInstance', options),
  openBrowserWindow: tabId => ipcRenderer.invoke('shellgpt:window:openBrowser', tabId),
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('shellgpt:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('shellgpt:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('shellgpt:ambient:claim', key),
  windowControls: {
    custom: customWindowControlsEnabled(),
    minimize: () => ipcRenderer.send('shellgpt:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('shellgpt:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('shellgpt:window-control', 'close')
  },
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('shellgpt:wake-indicator:get'),
    setState: state => ipcRenderer.send('shellgpt:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('shellgpt:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('shellgpt:wake-indicator:state', listener)
    }
  },
  chatOnboarding: {
    grow: request => ipcRenderer.send('shellgpt:chat-onboarding:grow', request),
    soloBoot: () => ipcRenderer.send('shellgpt:chat-onboarding:solo-boot')
  },
  introReveal: {
    open: (payload?: { hideMain?: boolean }) => ipcRenderer.invoke('shellgpt:intro-reveal:open', payload),
    close: (payload?: { showMain?: boolean }) => ipcRenderer.invoke('shellgpt:intro-reveal:close', payload),
    skip: () => ipcRenderer.send('shellgpt:intro-reveal:skip'),
    ready: () => ipcRenderer.send('shellgpt:intro-reveal:ready'),
    onSkip: callback => {
      const listener = () => callback()

      ipcRenderer.on('shellgpt:intro-reveal:skip', listener)

      return () => ipcRenderer.removeListener('shellgpt:intro-reveal:skip', listener)
    },
    onClosed: callback => {
      const listener = () => callback()

      ipcRenderer.on('shellgpt:intro-reveal:closed', listener)

      return () => ipcRenderer.removeListener('shellgpt:intro-reveal:closed', listener)
    }
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('shellgpt:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('shellgpt:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('shellgpt:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('shellgpt:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('shellgpt:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('shellgpt:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('shellgpt:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('shellgpt:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('shellgpt:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('shellgpt:hud:open', request),
    close: () => ipcRenderer.invoke('shellgpt:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('shellgpt:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('shellgpt:hud:begin-move'),
    endMove: () => ipcRenderer.send('shellgpt:hud:end-move'),
    moveBy: delta => ipcRenderer.send('shellgpt:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('shellgpt:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('shellgpt:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('shellgpt:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('shellgpt:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('shellgpt:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('shellgpt:hud:goto', listener)

      return () => ipcRenderer.removeListener('shellgpt:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('shellgpt:hud:changed', listener)

      return () => ipcRenderer.removeListener('shellgpt:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('shellgpt:hud:cursor', listener)

      return () => ipcRenderer.removeListener('shellgpt:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('shellgpt:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('shellgpt:hud:game-overlay', listener)
    }
  },
  hudModifier: {
    getSettings: () => ipcRenderer.invoke('shellgpt:hud-modifier:settings:get'),
    setEnabled: enabled => ipcRenderer.invoke('shellgpt:hud-modifier:settings:set', enabled),
    openPermissionSettings: () => ipcRenderer.invoke('shellgpt:hud-modifier:permission'),
    onStatus: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: HudModifierStatus) => callback(status)
      ipcRenderer.on('shellgpt:hud-modifier:status', listener)

      return () => ipcRenderer.removeListener('shellgpt:hud-modifier:status', listener)
    }
  } satisfies HudModifierApi,
  // macOS native screenshot gesture; captures require a main-issued request.
  screenshot:
    process.platform === 'darwin'
      ? {
          getSettings: () => ipcRenderer.invoke('shellgpt:screenshot:settings:get'),
          setEnabled: enabled => ipcRenderer.invoke('shellgpt:screenshot:settings:set', enabled),
          openPermissionSettings: kind => ipcRenderer.invoke('shellgpt:screenshot:permission', kind),
          capture: requestId => ipcRenderer.invoke('shellgpt:screenshot:capture', requestId),
          onStatus: callback => {
            const listener = (_event, status) => callback(status)
            ipcRenderer.on('shellgpt:screenshot:status', listener)

            return () => ipcRenderer.removeListener('shellgpt:screenshot:status', listener)
          },
          onRequest: callback => {
            const channel = 'shellgpt:screenshot:request'
            const listener = (_event, requestId) => callback(requestId)

            if (ipcRenderer.listenerCount(channel) === 0) {
              ipcRenderer.send('shellgpt:screenshot:subscribe', true)
            }

            ipcRenderer.on(channel, listener)

            return () => {
              ipcRenderer.removeListener(channel, listener)

              if (ipcRenderer.listenerCount(channel) === 0) {
                ipcRenderer.send('shellgpt:screenshot:subscribe', false)
              }
            }
          }
        }
      : undefined,
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('shellgpt:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('shellgpt:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('shellgpt:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('shellgpt:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('shellgpt:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('shellgpt:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('shellgpt:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('shellgpt:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('shellgpt:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('shellgpt:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('shellgpt:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('shellgpt:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('shellgpt:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('shellgpt:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('shellgpt:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('shellgpt:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('shellgpt:connections:list'),
    save: payload => ipcRenderer.invoke('shellgpt:connections:save', payload),
    remove: id => ipcRenderer.invoke('shellgpt:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('shellgpt:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('shellgpt:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('shellgpt:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('shellgpt:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('shellgpt:connections:update-managed', id),
    // Fan out `shellgpt update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('shellgpt:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:connections:changed', listener)

      return () => ipcRenderer.removeListener('shellgpt:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('shellgpt:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('shellgpt:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('shellgpt:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('shellgpt:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('shellgpt:connection-config:oauth-logout', remoteUrl),
  // ShellGPT Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('shellgpt:cloud:status'),
    login: () => ipcRenderer.invoke('shellgpt:cloud:login'),
    logout: () => ipcRenderer.invoke('shellgpt:cloud:logout'),
    discover: org => ipcRenderer.invoke('shellgpt:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('shellgpt:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    getDefault: () => ipcRenderer.invoke('shellgpt:profile:default:get'),
    setDefault: (route: DesktopProfileRoute) => ipcRenderer.invoke('shellgpt:profile:default:set', route),
    onDefaultChanged: (callback: (route: DesktopProfileRoute | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: DesktopProfileRoute | null) => callback(route)
      ipcRenderer.on('shellgpt:profile:default:changed', listener)

      return () => ipcRenderer.removeListener('shellgpt:profile:default:changed', listener)
    },
    get: () => ipcRenderer.invoke('shellgpt:profile:get'),
    remember: name => ipcRenderer.invoke('shellgpt:profile:remember', name),
    set: name => ipcRenderer.invoke('shellgpt:profile:set', name)
  },
  api: request => ipcRenderer.invoke('shellgpt:api', request),
  notify: payload => ipcRenderer.invoke('shellgpt:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('shellgpt:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('shellgpt:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('shellgpt:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('shellgpt:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('shellgpt:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('shellgpt:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('shellgpt:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('shellgpt:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('shellgpt:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('shellgpt:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('shellgpt:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('shellgpt:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('shellgpt:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('shellgpt:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('shellgpt:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('shellgpt:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('shellgpt:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('shellgpt:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('shellgpt:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('shellgpt:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('shellgpt:capturePreview', payload),
  savePastedText: text => ipcRenderer.invoke('shellgpt:savePastedText', { text }),
  saveClipboardImage: () => ipcRenderer.invoke('shellgpt:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('shellgpt:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('shellgpt:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('shellgpt:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('shellgpt:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('shellgpt:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('shellgpt:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('shellgpt:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('shellgpt:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('shellgpt:keep-awake', on),
  minimizeToTray: {
    get: () => ipcRenderer.invoke('shellgpt:minimize-to-tray:get'),
    set: on => ipcRenderer.invoke('shellgpt:minimize-to-tray:set', on),
    onChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('shellgpt:minimize-to-tray:changed', listener)

      return () => ipcRenderer.removeListener('shellgpt:minimize-to-tray:changed', listener)
    }
  },
  setDisableF12: blocked => ipcRenderer.send('shellgpt:devtools:disable-f12', blocked),
  setF12ShortcutActive: active => ipcRenderer.send('shellgpt:f12ShortcutActive', Boolean(active)),
  onF12Shortcut: callback => {
    const listener = (_event, input) => callback(input)
    ipcRenderer.on('shellgpt:f12-shortcut', listener)

    return () => ipcRenderer.removeListener('shellgpt:f12-shortcut', listener)
  },
  setPreviewShortcutActive: active => ipcRenderer.send('shellgpt:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('shellgpt:openExternal', url),
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('shellgpt:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('shellgpt:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('shellgpt:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('shellgpt:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('shellgpt:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('shellgpt:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('shellgpt:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('shellgpt:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('shellgpt:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('shellgpt:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('shellgpt:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('shellgpt:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('shellgpt:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('shellgpt:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:zoom:changed', listener)

      return () => ipcRenderer.removeListener('shellgpt:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('shellgpt:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('shellgpt:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('shellgpt:logs:renderer-error', report),
  readDir: dirPath => ipcRenderer.invoke('shellgpt:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('shellgpt:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('shellgpt:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('shellgpt:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('shellgpt:fs:desktopPluginsRoot'),
  reconcileDesktopPlugins: () => ipcRenderer.invoke('shellgpt:fs:reconcileDesktopPlugins'),
  logsRoot: () => ipcRenderer.invoke('shellgpt:fs:logsRoot'),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('shellgpt:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('shellgpt:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('shellgpt:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('shellgpt:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('shellgpt:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('shellgpt:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('shellgpt:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('shellgpt:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('shellgpt:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('shellgpt:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('shellgpt:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('shellgpt:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('shellgpt:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('shellgpt:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('shellgpt:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('shellgpt:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('shellgpt:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('shellgpt:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('shellgpt:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('shellgpt:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('shellgpt:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('shellgpt:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('shellgpt:git:review:prList', repoPath, branches, numbers),
      createPr: repoPath => ipcRenderer.invoke('shellgpt:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('shellgpt:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('shellgpt:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('shellgpt:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('shellgpt:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('shellgpt:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('shellgpt:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `shellgpt:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `shellgpt:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('shellgpt:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('shellgpt:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('shellgpt:preview-nav', listener)

    return () => ipcRenderer.removeListener('shellgpt:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('shellgpt:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('shellgpt:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('shellgpt:open-updates', listener)

    return () => ipcRenderer.removeListener('shellgpt:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:deep-link', listener)

    return () => ipcRenderer.removeListener('shellgpt:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('shellgpt:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('shellgpt:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('shellgpt:plugin:installDesktop', payload),
  removeDesktopPlugin: payload => ipcRenderer.invoke('shellgpt:plugin:removeDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:window-state-changed', listener)

    return () => ipcRenderer.removeListener('shellgpt:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('shellgpt:focus-session', listener)

    return () => ipcRenderer.removeListener('shellgpt:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:notification-action', listener)

    return () => ipcRenderer.removeListener('shellgpt:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:notification-activate', listener)

    return () => ipcRenderer.removeListener('shellgpt:notification-activate', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('shellgpt:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:backend-exit', listener)

    return () => ipcRenderer.removeListener('shellgpt:backend-exit', listener)
  },
  // Cooperative pool retirement (main → renderer): the pooled backend under
  // `poolKey` is being stopped for a foreground open. Park that scope; do not
  // redial into the slot it vacated.
  onPoolBackendRetiring: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:pool:retiring', listener)

    return () => ipcRenderer.removeListener('shellgpt:pool:retiring', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('shellgpt:connection:applied', listener)

    return () => ipcRenderer.removeListener('shellgpt:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('shellgpt:power-resume', listener)

    return () => ipcRenderer.removeListener('shellgpt:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('shellgpt:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('shellgpt:power-battery', listener)

    return () => ipcRenderer.removeListener('shellgpt:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:boot-progress', listener)

    return () => ipcRenderer.removeListener('shellgpt:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('shellgpt:bootstrap:get'),
  continueBootstrapLocal: () => ipcRenderer.invoke('shellgpt:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('shellgpt:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('shellgpt:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('shellgpt:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('shellgpt:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('shellgpt:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('shellgpt:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('shellgpt:version'),
  relaunchApp: () => ipcRenderer.invoke('shellgpt:app:relaunch'),
  getMachineProfile: () => ipcRenderer.invoke('shellgpt:machine:profile'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('shellgpt:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('shellgpt:uninstall:summary'),
    run: mode => ipcRenderer.invoke('shellgpt:uninstall:run', { mode })
  },
  updates: {
    check: opts => ipcRenderer.invoke('shellgpt:updates:check', opts),
    apply: opts => ipcRenderer.invoke('shellgpt:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('shellgpt:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('shellgpt:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('shellgpt:updates:progress', listener)

      return () => ipcRenderer.removeListener('shellgpt:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('shellgpt:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('shellgpt:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('shellgpt:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('shellgpt:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('shellgpt:found-in-page', listener)

    return () => ipcRenderer.removeListener('shellgpt:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('shellgpt:open-find-bar', listener)

    return () => ipcRenderer.removeListener('shellgpt:open-find-bar', listener)
  }
})
