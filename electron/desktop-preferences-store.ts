/**
 * 桌面偏好 JSON 持久化（托盘、登录启动项、语言）。
 * Persist desktop preferences JSON (tray, login item, locale).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ClaudePermissionMode } from '../src/claude-chat-types'
import type { DesktopPreferences } from '../src/desktop-types'
import { normalizeUiLocale } from './ui-locale'

const PREFS_FILE_NAME = 'desktop-preferences.json'

const DEFAULT_PREFS: DesktopPreferences = {
  closeToTray: false,
  openAtLogin: false,
  eyeComfortMode: false,
  locale: 'zh',
}

function normalizePrefs(raw: unknown): DesktopPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
  const o = raw as Record<string, unknown>
  const chatPermissionMode = isClaudePermissionMode(o.chatPermissionMode) ? o.chatPermissionMode : undefined
  return {
    closeToTray: o.closeToTray === true,
    openAtLogin: o.openAtLogin === true,
    eyeComfortMode: o.eyeComfortMode === true,
    locale: normalizeUiLocale(o.locale),
    ...(chatPermissionMode ? { chatPermissionMode } : {}),
  }
}

export type StoredChatPermissionMode =
  | { kind: 'missing' }
  | { kind: 'valid'; value: ClaudePermissionMode }
  | { kind: 'invalid' }

function isClaudePermissionMode(value: unknown): value is ClaudePermissionMode {
  return value === 'plan' || value === 'auto' || value === 'default' || value === 'acceptEdits' || value === 'bypassPermissions'
}

/** userData 内的桌面偏好读写器 / Reader/writer for desktop preferences in userData */
export class DesktopPreferencesStore {
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, PREFS_FILE_NAME)
  }

  read(): DesktopPreferences {
    if (!existsSync(this.filePath)) return { ...DEFAULT_PREFS }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      return normalizePrefs(raw)
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }

  /** Preserves missing versus malformed on-disk state for Main-only migration. */
  readChatPermissionModeState(): StoredChatPermissionMode {
    if (!existsSync(this.filePath)) return { kind: 'missing' }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(raw, 'chatPermissionMode')) return { kind: 'missing' }
      const value = (raw as Record<string, unknown>).chatPermissionMode
      return isClaudePermissionMode(value) ? { kind: 'valid', value } : { kind: 'invalid' }
    } catch {
      return { kind: 'missing' }
    }
  }

  save(partial: Partial<DesktopPreferences>): DesktopPreferences {
    const next: DesktopPreferences = {
      ...this.read(),
      ...partial,
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  }
}
