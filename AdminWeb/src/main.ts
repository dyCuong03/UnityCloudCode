// ─── Admin Mail SPA — main.ts (proxy model) ──────────────────────────────────────
// Mirrors the Unity Editor AdminMailWindow for browser use.
// All Cloud Code calls route through a serverless proxy — no UGS Key/Secret in browser.
import './style.css'

import {
  saveCredentials,
  loadCredentials,
  clearAllCredentials,
  effectiveProxyBase,
  ApiError,
  apiSendGlobalMail,
  apiGetGlobalMails,
  apiGetUserMailsAdmin,
  apiSetMailEndTime,
  apiUpdateGlobalMail,
  apiExpireMail,
  apiDeleteGlobalMail,
  apiPurgeExpired,
} from './api'

import type { ProxyCallArgs } from './api'

import {
  CATEGORY_OPTIONS,
  mailId,
  mailEndTime,
  mailTargetUsers,
} from './types'

import type {
  AttachmentDraft,
  MailRecord,
  MailScope,
} from './types'

import { buildAttachments } from './modules/build-attachments'

import { CURRENCY_IDS, ITEM_IDS, TICKET_IDS, CURRENCY_OPTIONS } from './generated/lookup-data'
import { buildMailExportJson } from './mail-export'
import {
  defaultAppState,
} from './state'
import type { AppState } from './state'
import { mountManageTab } from './modules/mail-list'
import type { ManageTabHandle } from './modules/mail-list'
import type { ComboboxOption } from './modules/asset-selector'
import { mountSendForm } from './modules/send-form'
import type { SendFormHandle, SendFormPayload } from './modules/send-form'
import {
  BUILD_CONFIG,
  hasBakedProjectId,
  hasBakedOperatorId,
  environmentOptions,
  defaultEnvValue,
  resolveEnvValue,
} from './modules/app-config'

// ─── Constants ────────────────────────────────────────────────────────────────────

const MAILS_PER_PAGE = 5
const FETCH_PAGE_SIZE = 50
const MAX_FETCH_PAGES = 20

// ─── Module-level handles ─────────────────────────────────────────────────────────

let _manageTabHandle: ManageTabHandle | null = null
let _sendFormHandle:  SendFormHandle  | null = null

// ─── Combobox options from generated lookup data ──────────────────────────────────

const CURRENCY_COMBOBOX_OPTIONS: ComboboxOption[] = CURRENCY_OPTIONS.map(o => ({
  id:    o.id,
  label: o.name,
}))
const ITEM_COMBOBOX_OPTIONS: ComboboxOption[]   = ITEM_IDS.map(id => ({ id }))
const TICKET_COMBOBOX_OPTIONS: ComboboxOption[] = TICKET_IDS.map(id => ({ id }))

// ─── App state ────────────────────────────────────────────────────────────────────

const state: AppState = defaultAppState()

// ─── Utility helpers ──────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`Element #${id} not found`)
  return e as T
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
}

// ─── Connection ───────────────────────────────────────────────────────────────────

function resolveProxyArgs(): ProxyCallArgs {
  const pb = effectiveProxyBase()
  if (!state.connection.proxyToken) {
    throw new Error('Proxy access token is required. Enter it in the connection form.')
  }
  return {
    proxyBase:   pb,
    proxyToken:  state.connection.proxyToken,
    projectId:   state.connection.projectId,
    environment: state.connection.environment,
    moduleName:  state.connection.moduleName || 'BackpackAdventuresModule',
  }
}

function isConnected(): boolean {
  return (
    !!state.connection.projectId &&
    !!state.connection.environment &&
    !!state.connection.moduleName &&
    !!state.connection.operatorId &&
    !!state.connection.proxyToken
  )
}

// ─── Status bar ───────────────────────────────────────────────────────────────────

function setStatus(msg: string, type: AppState['statusType'], raw = '') {
  state.statusMsg  = msg
  state.statusType = type
  state.rawJson    = raw
  renderStatus()
}

function renderStatus() {
  const bar = document.getElementById('status-bar')
  if (!bar) return
  let alertHtml = ''
  if (state.statusMsg) {
    const cls = state.statusType ? `alert-${state.statusType}` : 'alert-info'
    alertHtml = `<div class="alert ${cls}">${esc(state.statusMsg)}</div>`
  }
  const rawHtml = state.rawJson
    ? `<details><summary>Server response JSON</summary><div class="json-box">${esc(state.rawJson)}</div></details>`
    : ''
  bar.innerHTML = alertHtml + rawHtml
}

// ─── Connection status dot ────────────────────────────────────────────────────────

function renderConnectionDot() {
  const dot = document.getElementById('conn-dot')
  if (!dot) return
  if (isConnected()) {
    dot.className = 'status-dot ready'
    dot.title = `Connected — ${state.connection.moduleName} / ${state.connection.environment}`
  } else if (state.connection.proxyToken || state.connection.projectId) {
    dot.className = 'status-dot partial'
    dot.title = 'Partial credentials'
  } else {
    dot.className = 'status-dot'
    dot.title = 'Not connected'
  }
}

// ─── Scope label (KEEP — used by doCopyMailAsJson) ────────────────────────────────

function getScopeLabel(m: MailRecord, source: 'global' | 'user'): MailScope {
  if (source === 'user') return 'User'
  const targets = mailTargetUsers(m)
  return targets.length > 0 ? 'Global-targeted' : 'Global'
}

// ─── Send form deps ───────────────────────────────────────────────────────────────

function _buildSendFormDeps() {
  return {
    getEnv:          () => state.connection.environment,
    isBusy:          () => state.busy,
    isConnected,
    currencyOptions: CURRENCY_COMBOBOX_OPTIONS,
    itemOptions:     ITEM_COMBOBOX_OPTIONS,
    ticketOptions:   TICKET_COMBOBOX_OPTIONS,
    onSend(payload: SendFormPayload) {
      void run(async () => {
        const args = resolveProxyArgs()
        const { recipientMode, subject, body, schedule, category, senderName, dedupKey, targetUserIds, attachments } = payload

        if (!subject || subject.length > 128) throw new Error('Title must be 1-128 characters.')
        if (!body || body.length > 1024)     throw new Error('Content must be 1-1024 characters.')

        let expiresAt: string | null = null
        if (schedule.expiryMode === 'set') {
          const raw = `${schedule.expiryDate.trim()}T${schedule.expiryTime.trim()}:00Z`
          const d = new Date(raw)
          if (isNaN(d.getTime())) throw new Error('End Time: invalid date/time. Use yyyy-MM-dd and HH:mm.')
          expiresAt = d.toISOString()
        }

        const builtAttachments = buildAttachments(attachments)

        if (recipientMode === 'targeted') {
          if (!targetUserIds || targetUserIds.length === 0) {
            throw new Error('At least one Target User ID is required.')
          }
        }

        const { data, rawResponse } = await apiSendGlobalMail(args, {
          subject, body, expiresAt,
          mailCategory: CATEGORY_OPTIONS[category] ?? null,
          senderName, dedupKey,
          attachments: builtAttachments,
          operatorId: state.connection.operatorId,
          targetUserIds: recipientMode === 'targeted' ? targetUserIds : null,
          adminToken: null,
        })

        const mId = data.mailId ?? data.globalMailId ?? '(unknown)'
        setStatus(
          `${recipientMode === 'targeted' ? 'SendTargetedMail' : 'SendGlobalMail'}: mailId=${mId} sentAt=${data.sentAt ?? '-'}`,
          'success', rawResponse,
        )

        _sendFormHandle?.reset()
      })
    },
    onStatusMessage(msg: string, type: 'success' | 'error' | 'warning' | 'info') {
      setStatus(msg, type)
    },
  }
}

// ─── Manage tab deps ──────────────────────────────────────────────────────────────

function _buildManageTabDeps() {
  return {
    getMails:              () => state.manageTab.mailList,
    getUserMails:          () => state.manageTab.userMailList,
    getMailPage:           () => state.manageTab.page,
    getMailTotalCount:     () => state.manageTab.mailList?.length ?? 0,
    getMailError:          () => state.manageTab.error ?? '',
    getUserMailError:      () => state.manageTab.userMailError,
    getUserLookupPlayerId: () => state.manageTab.userMailLookupPlayerId,
    isBusy:                () => state.busy,
    isConnected,
    getEnv:                () => state.connection.environment,
    currencyOptions:       CURRENCY_COMBOBOX_OPTIONS,
    itemOptions:           ITEM_COMBOBOX_OPTIONS,
    ticketOptions:         TICKET_COMBOBOX_OPTIONS,
    onLoad() { void run(() => doLoadMails(true, true)) },
    onLookupUser(pid: string) {
      state.manageTab.userMailLookupPlayerId = pid
      void run(() => _doFetchUserMailById(pid))
    },
    onSave(mId: string, subject: string, body: string, drafts: AttachmentDraft[], targetUserIds: string[] | null, expiresAt: string | null) {
      void run(async () => {
        const args = resolveProxyArgs()
        const atts = buildAttachments(drafts)
        const { data, rawResponse } = await apiUpdateGlobalMail(args, {
          mailId: mId, subject, body, attachments: atts,
          targetUserIds: targetUserIds ?? null,
          operatorId: state.connection.operatorId, adminToken: null,
        })
        // If expiresAt differs from current, also set end time
        const curr = state.manageTab.mailList?.find(m => mailId(m) === mId)
        const currEnd = curr ? mailEndTime(curr) : null
        if (expiresAt !== currEnd) {
          await apiSetMailEndTime(args, {
            mailId: mId, endTime: expiresAt, operatorId: state.connection.operatorId, adminToken: null,
          })
        }
        setStatus(`Updated: mailId=${data.mailId ?? mId}`, 'success', rawResponse)
        await refreshLoadedMails()
      })
    },
    onExpire(mId: string) {
      void run(async () => {
        if (!window.confirm(`Expire mail ${mId}? Sets expiry to now.`)) return
        const args = resolveProxyArgs()
        const { data, rawResponse } = await apiExpireMail(args, {
          mailId: mId, operatorId: state.connection.operatorId, adminToken: null,
        })
        setStatus(`ExpireMail: mailId=${data.mailId ?? mId} expiredAt=${data.expiredAt ?? '-'}`, 'success', rawResponse)
        await refreshLoadedMails()
      })
    },
    onDelete(mId: string) {
      void run(async () => {
        if (!window.confirm(`Delete mail ${mId}? Irreversible.`)) return
        const args = resolveProxyArgs()
        const { data, rawResponse } = await apiDeleteGlobalMail(args, {
          mailId: mId, operatorId: state.connection.operatorId, adminToken: null,
        })
        setStatus(`DeleteGlobalMail: mailId=${data.mailId ?? mId}`, 'success', rawResponse)
        await refreshLoadedMails()
      })
    },
    onCopyJson(mId: string, source: 'global' | 'user') {
      void run(() => doCopyMailAsJson(mId, source))
    },
    onPurge() { void run(doPurgeExpired) },
    onPageChange(delta: number) {
      state.manageTab.page = Math.max(0, state.manageTab.page + delta)
      refreshMainPanel()
    },
    onSetEndTime(mId: string, endTime: string | null) {
      void run(async () => {
        const args = resolveProxyArgs()
        const { data, rawResponse } = await apiSetMailEndTime(args, {
          mailId: mId, endTime, operatorId: state.connection.operatorId, adminToken: null,
        })
        setStatus(`SetMailEndTime: mailId=${data.mailId ?? mId} endTime=${data.endTime ?? 'null'}`, 'success', rawResponse)
        await refreshLoadedMails()
      })
    },
  }
}

// ─── Sidebar — Connection form ────────────────────────────────────────────────────

function renderSidebar(): string {
  return `
  <div class="alert alert-security">
    🔒 <strong>Proxy model:</strong> UGS service-account credentials are handled server-side
    by the same-origin Cloudflare Pages Function. This form never receives, stores, or transmits your Key or Secret.
    Only the <strong>Proxy Access Token</strong> is sensitive — it is kept in memory only
    and cleared on "Logout". All other fields are session-stored for convenience.
  </div>

  <div class="card">
    <div class="card-title">🔑 Connection</div>
    ${hasBakedProjectId
      ? ''
      : `<div class="form-group">
      <label>Module Name</label>
      <input type="text" id="c-module" value="${esc(state.connection.moduleName)}" placeholder="BackpackAdventuresModule" autocomplete="off" />
    </div>
    <div class="form-group">
      <label>Project ID</label>
      <input type="text" id="c-project-id" value="${esc(state.connection.projectId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" />
    </div>`}
    <div class="form-group">
      <label>Environment</label>
      <select id="c-env" autocomplete="off">
        ${environmentOptions().map(o =>
          `<option value="${esc(o.value)}"${o.value === state.connection.environment ? ' selected' : ''}>${esc(o.label)}</option>`,
        ).join('')}
      </select>
    </div>
    ${hasBakedOperatorId
      ? ''
      : `<div class="form-group">
      <label>Operator ID (email)</label>
      <input type="text" id="c-operator" value="${esc(state.connection.operatorId)}" placeholder="admin@example.com" autocomplete="off" />
    </div>`}
    <div class="form-group">
      <label>Proxy Access Token <span style="color:var(--accent)">★ session-only</span></label>
      <input type="password" id="c-token" value="" placeholder="Proxy bearer token (not stored)" autocomplete="new-password" />
      ${state.connection.proxyToken ? '<small style="color:var(--success);font-size:11px">✓ Token in memory</small>' : ''}
    </div>
    ${isConnected()
      ? `<div class="alert alert-success" style="font-size:12px">✓ Connected — ${esc(state.connection.moduleName)} / ${esc(state.connection.environment)}</div>`
      : ''}
    <div class="btn-row">
      <button class="btn btn-primary" id="c-connect" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? '<span class="spinner"></span>' : '⚡'} Connect
      </button>
      <button class="btn btn-ghost" id="c-logout">🚪 Logout / Clear</button>
    </div>
  </div>

  <div id="status-bar"></div>`
}

// ─── Full page render ─────────────────────────────────────────────────────────────

function renderApp() {
  const isManage = state.activeTab === 'manage'
  const mainContent = isManage
    ? `<div id="manage-panel"></div>`
    : `<div id="send-panel"></div>`

  el<HTMLDivElement>('app').innerHTML = `
  <header class="app-header">
    <span id="conn-dot" class="status-dot"></span>
    <h1>Admin Mail</h1>
    <span class="badge">BackpackAdventures</span>
    <div style="margin-left:auto;font-size:12px;color:var(--text-dim)">via Proxy → UGS Cloud Code</div>
  </header>
  <div class="app-body">
    <aside class="sidebar" id="sidebar">${renderSidebar()}</aside>
    <main class="main-content">
      <div class="tabs">
        <button class="tab-btn ${state.activeTab === 'send'   ? 'active' : ''}" id="tab-send">✉️ Send Mail</button>
        <button class="tab-btn ${state.activeTab === 'manage' ? 'active' : ''}" id="tab-manage">📋 Manage Mails</button>
      </div>
      <div id="main-panel">${mainContent}</div>
    </main>
  </div>`

  renderConnectionDot()
  renderStatus()
  attachAllListeners()

  _manageTabHandle?.destroy()
  _manageTabHandle = null
  _sendFormHandle?.destroy()
  _sendFormHandle = null

  if (isManage) {
    const mp = document.getElementById('manage-panel')
    if (mp) _manageTabHandle = mountManageTab(mp, _buildManageTabDeps())
  } else {
    const sp = document.getElementById('send-panel')
    if (sp) _sendFormHandle = mountSendForm(sp, _buildSendFormDeps())
  }
}

// ─── Partial re-renders ───────────────────────────────────────────────────────────

function refreshSidebar() {
  const sb = document.getElementById('sidebar')
  if (!sb) { renderApp(); return }
  sb.innerHTML = renderSidebar()
  renderConnectionDot()
  renderStatus()
  attachSidebarListeners()
}

function refreshMainPanel() {
  const panel = document.getElementById('main-panel')
  if (!panel) { renderApp(); return }

  if (state.activeTab === 'manage') {
    _sendFormHandle?.destroy()
    _sendFormHandle = null
    _manageTabHandle?.destroy()
    _manageTabHandle = null
    panel.innerHTML = `<div id="manage-panel"></div>`
    attachMainListeners()
    const mp = document.getElementById('manage-panel')
    if (mp) _manageTabHandle = mountManageTab(mp, _buildManageTabDeps())
    return
  }

  // Send tab
  _manageTabHandle?.destroy()
  _manageTabHandle = null
  _sendFormHandle?.destroy()
  _sendFormHandle = null
  panel.innerHTML = `<div id="send-panel"></div>`
  attachMainListeners()
  const sp = document.getElementById('send-panel')
  if (sp) _sendFormHandle = mountSendForm(sp, _buildSendFormDeps())
}

// ─── Event listeners ──────────────────────────────────────────────────────────────

function attachSidebarListeners() {
  document.getElementById('c-connect')?.addEventListener('click', () => run(doConnect))
  document.getElementById('c-logout')?.addEventListener('click',  () => run(doLogout))
}

function attachMainListeners() {
  document.getElementById('tab-send')?.addEventListener('click', () => { state.activeTab = 'send'; renderApp() })
  document.getElementById('tab-manage')?.addEventListener('click', () => { state.activeTab = 'manage'; renderApp() })
}

function attachAllListeners() {
  attachSidebarListeners()
  attachMainListeners()
}

// ─── Async action runner ──────────────────────────────────────────────────────────

async function run(action: () => Promise<void>) {
  if (state.busy) return
  state.busy = true
  setStatus('Working…', 'info')
  try {
    await action()
  } catch (err) {
    const msg = err instanceof ApiError
      ? `Error ${err.status}: ${err.message}` : err instanceof Error ? err.message : String(err)
    const raw = err instanceof ApiError ? (err.body ?? '') : ''
    setStatus(msg, 'error', raw)
  } finally {
    state.busy = false
    refreshMainPanel()
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────────

async function doConnect() {
  // Baked fields (project id / operator id / module name) come from the build
  // config; only fields still rendered in the form are read from inputs.
  const moduleName  = hasBakedProjectId  ? BUILD_CONFIG.moduleName  : (val('c-module').trim() || BUILD_CONFIG.moduleName)
  const projectId   = hasBakedProjectId  ? BUILD_CONFIG.projectId   : val('c-project-id').trim()
  const operatorId  = hasBakedOperatorId ? BUILD_CONFIG.operatorId  : val('c-operator').trim()
  const environment = val('c-env').trim() || defaultEnvValue()
  const proxyToken  = (document.getElementById('c-token') as HTMLInputElement | null)?.value ?? ''

  if (!projectId || !environment || !operatorId || !proxyToken) {
    const missing = [
      !projectId   && 'Project ID',
      !environment && 'Environment',
      !operatorId  && 'Operator ID',
      !proxyToken  && 'Proxy Token',
    ].filter(Boolean).join(', ')
    setStatus(`${missing} ${missing.includes(',') ? 'are' : 'is'} required.`, 'error')
    refreshSidebar()
    return
  }

  state.connection.moduleName  = moduleName
  state.connection.projectId   = projectId
  state.connection.environment = environment
  state.connection.operatorId  = operatorId
  state.connection.proxyToken  = proxyToken   // memory only — NOT saved to sessionStorage

  saveCredentials({ projectId, environment, moduleName, operatorId })

  setStatus(
    `Connected — ${moduleName} / ${environment} via same-origin proxy`,
    'success',
  )
  refreshSidebar()
  refreshMainPanel()
}

async function doLogout() {
  clearAllCredentials()
  state.connection.projectId   = BUILD_CONFIG.projectId
  state.connection.environment = defaultEnvValue()
  state.connection.moduleName  = BUILD_CONFIG.moduleName
  state.connection.operatorId  = BUILD_CONFIG.operatorId
  state.connection.proxyToken  = ''    // cleared from memory
  setStatus('Logged out — all credentials cleared.', 'info')
  renderApp()
}

async function doLoadMails(resetPage = false, showStatus = true) {
  const args = resolveProxyArgs()
  if (resetPage) state.manageTab.page = 0
  state.manageTab.error = null
  const all: MailRecord[] = []
  let page = 0
  let hasMore = true
  let lastRawResponse = ''

  while (hasMore) {
    const { data, rawResponse } = await apiGetGlobalMails(args, {
      page,
      pageSize: FETCH_PAGE_SIZE,
      adminMode: true,
      operatorId: state.connection.operatorId,
      adminToken: null,
    })
    const mails = data.Mails ?? data.mails ?? []
    all.push(...mails)
    hasMore = data.HasMore ?? data.hasMore ?? false
    lastRawResponse = rawResponse
    page++
    if (page >= MAX_FETCH_PAGES) break
  }

  state.manageTab.mailList = all
  const maxPage = Math.max(0, Math.ceil(all.length / MAILS_PER_PAGE) - 1)
  if (state.manageTab.page > maxPage) state.manageTab.page = maxPage
  if (showStatus) {
    setStatus(`GetGlobalMails: loaded ${all.length} mails (${MAILS_PER_PAGE} per page)`, 'success', lastRawResponse)
  }
}

async function refreshLoadedMails() {
  if (state.manageTab.mailList !== null) await doLoadMails(false, false)
}

async function _doFetchUserMailById(playerId: string) {
  if (!playerId) throw new Error('Player ID is required.')
  const args = resolveProxyArgs()
  state.manageTab.userMailList  = null
  state.manageTab.userMailError = ''
  const all: MailRecord[] = []
  let page = 0; let hasMore = true; let lastRaw = ''
  while (hasMore) {
    const { data, rawResponse } = await apiGetUserMailsAdmin(args, {
      targetPlayerId: playerId, page, pageSize: FETCH_PAGE_SIZE,
      operatorId: state.connection.operatorId, adminToken: '',
    })
    all.push(...(data.Mails ?? data.mails ?? []))
    hasMore = data.HasMore ?? data.hasMore ?? false
    lastRaw = rawResponse; page++
    if (page >= MAX_FETCH_PAGES) break
  }
  state.manageTab.userMailList = all
  setStatus(`GetUserMailsAdmin: loaded ${all.length} user mails for ${playerId}`, 'success', lastRaw)
}

async function doPurgeExpired() {
  const args = resolveProxyArgs()
  if (!confirm('Purge all expired global mails? Irreversible.')) return

  const { data, rawResponse } = await apiPurgeExpired(args, {
    operatorId: state.connection.operatorId, adminToken: null,
  })
  setStatus(`PurgeExpired: purgedCount=${data.purgedCount ?? 0} at ${data.purgedAt ?? '-'}`, 'success', rawResponse)
  await refreshLoadedMails()
}

// ─── Copy mail as JSON ────────────────────────────────────────────────────────────

function findMailById(mailIdValue: string, source: 'global' | 'user'): MailRecord | undefined {
  const list = source === 'user' ? state.manageTab.userMailList : state.manageTab.mailList
  return list?.find(m => mailId(m) === mailIdValue)
}

async function doCopyMailAsJson(mailIdValue: string, source: 'global' | 'user') {
  const m = findMailById(mailIdValue, source)
  if (!m) throw new Error(`Mail not found: ${mailIdValue}`)

  const scope: MailScope = getScopeLabel(m, source)
  const exported = buildMailExportJson(m, scope, state.connection.environment, new Date().toISOString())
  const json = JSON.stringify(exported, null, 2)

  try {
    await navigator.clipboard.writeText(json)
    setStatus(`Copied mail ${mailIdValue} to clipboard (schemaVersion:1)`, 'success')
  } catch {
    // Fallback: show in status bar for manual copy
    setStatus(`Clipboard unavailable — copy the JSON below manually`, 'warning', json)
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────────

function init() {
  const saved = loadCredentials()
  // Baked build config wins over session storage for the fields it provides.
  state.connection.projectId   = hasBakedProjectId  ? BUILD_CONFIG.projectId  : saved.projectId
  state.connection.operatorId  = hasBakedOperatorId ? BUILD_CONFIG.operatorId : saved.operatorId
  state.connection.moduleName  = BUILD_CONFIG.moduleName
  state.connection.environment = resolveEnvValue(saved.environment)
  // proxyToken always starts empty — operator must re-enter each session
  renderApp()
}

init()
