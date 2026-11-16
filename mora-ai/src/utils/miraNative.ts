import { Capacitor, registerPlugin } from '@capacitor/core'

export interface PermissionsStatus {
  overlay: boolean
  accessibility: boolean
  writeSettings: boolean
  microphone: boolean
  contacts: boolean
  callPhone: boolean
  notifications: boolean
}

interface MiraNativePlugin {
  syncWallpaperState(opts: { outfit: string; stage: string; commanderName: string }): Promise<{ ok: boolean }>
  syncAiConfig(opts: { geminiApiKey: string; geminiModel: string }): Promise<{ ok: boolean }>
  setLiveWallpaper(opts: { outfit: string; stage: string; commanderName: string }): Promise<{ ok: boolean; mode: string }>
  setStaticWallpaper(opts: { outfit: string; stage: string; commanderName: string }): Promise<{ ok: boolean; mode: string }>
  openApp(opts: { target: string }): Promise<{ ok: boolean; launched?: string }>
  openUrl(opts: { url: string }): Promise<{ ok: boolean }>
  toggleFlashlight(opts: { on?: boolean }): Promise<{ ok: boolean; on: boolean }>
  getDeviceBattery(): Promise<{ level: number; charging: boolean }>
  setSystemAlarm(opts: { hour: number; minute: number; message: string }): Promise<{ ok: boolean }>
  checkPermissionsStatus(): Promise<PermissionsStatus>
  requestRuntimePermissions(): Promise<{ ok: boolean }>
  requestOverlayPermission(): Promise<{ ok: boolean }>
  requestAccessibilityPermission(): Promise<{ ok: boolean }>
  requestWriteSettingsPermission(): Promise<{ ok: boolean }>
  startWakeWordService(): Promise<{ ok: boolean }>
  stopWakeWordService(): Promise<{ ok: boolean }>
  showMiniMiraOverlay(opts: { command?: string }): Promise<{ ok: boolean }>
  hideMiniMiraOverlay(): Promise<{ ok: boolean }>
  executeDeviceCommand(opts: { command: string }): Promise<{ handled: boolean; reply: string; actionTag: string }>
}

const MiraNative = registerPlugin<MiraNativePlugin>('MiraNative')

export const isAndroidNative = () => Capacitor.isNativePlatform()

export async function nativeSyncWallpaper(outfit: string, stage: string, commanderName: string) {
  if (!isAndroidNative()) return { ok: false, webOnly: true }
  return MiraNative.syncWallpaperState({ outfit, stage, commanderName })
}

export async function nativeSyncAiConfig(geminiApiKey: string, geminiModel: string) {
  if (!isAndroidNative()) return { ok: false }
  return MiraNative.syncAiConfig({ geminiApiKey, geminiModel })
}

export async function nativeCheckPermissions(): Promise<PermissionsStatus | null> {
  if (!isAndroidNative()) return null
  try {
    return await MiraNative.checkPermissionsStatus()
  } catch {
    return null
  }
}

export async function nativeRequestRuntimePermissions() {
  if (!isAndroidNative()) return
  await MiraNative.requestRuntimePermissions()
}

export async function nativeRequestOverlayPermission() {
  if (!isAndroidNative()) return
  await MiraNative.requestOverlayPermission()
}

export async function nativeRequestAccessibilityPermission() {
  if (!isAndroidNative()) return
  await MiraNative.requestAccessibilityPermission()
}

export async function nativeRequestWriteSettingsPermission() {
  if (!isAndroidNative()) return
  await MiraNative.requestWriteSettingsPermission()
}

export async function nativeStartWakeWordService(): Promise<{ ok: boolean; message: string }> {
  if (!isAndroidNative()) {
    return { ok: false, message: 'Background Hey MIRA service runs inside the Android APK!' }
  }
  try {
    await MiraNative.startWakeWordService()
    return { ok: true, message: 'Hey MIRA background wake-word listener is now ACTIVE!' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function nativeStopWakeWordService() {
  if (!isAndroidNative()) return
  await MiraNative.stopWakeWordService()
}

export async function nativeShowMiniMiraOverlay(command?: string): Promise<{ ok: boolean; message: string }> {
  if (!isAndroidNative()) {
    return { ok: false, message: 'Floating Mini MIRA Assistant Overlay works inside the Android APK!' }
  }
  try {
    await MiraNative.showMiniMiraOverlay({ command })
    return { ok: true, message: 'Summoned Mini MIRA floating assistant!' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function nativeExecuteDeviceCommand(
  command: string,
): Promise<{ handled: boolean; reply: string; actionTag: string }> {
  if (!isAndroidNative()) {
    return { handled: false, reply: '', actionTag: '' }
  }
  try {
    return await MiraNative.executeDeviceCommand({ command })
  } catch {
    return { handled: false, reply: '', actionTag: '' }
  }
}

export async function nativeSetLiveWallpaper(outfit: string, stage: string, commanderName: string) {
  if (!isAndroidNative()) {
    return {
      ok: false,
      webOnly: true,
      message: 'Live Wallpaper chooser opens directly inside the MIRA AI Android APK!',
    }
  }
  const res = await MiraNative.setLiveWallpaper({ outfit, stage, commanderName })
  return { ...res, webOnly: false, message: 'Opened Android Live Wallpaper picker for MIRA!' }
}

export async function nativeSetStaticWallpaper(outfit: string, stage: string, commanderName: string) {
  if (!isAndroidNative()) {
    return {
      ok: false,
      webOnly: true,
      message: 'Direct Home/Lock Screen wallpaper works inside the MIRA AI Android APK!',
    }
  }
  const res = await MiraNative.setStaticWallpaper({ outfit, stage, commanderName })
  return { ...res, webOnly: false, message: 'MIRA wallpaper applied directly to your Android screen!' }
}

export async function nativeOpenApp(target: string): Promise<{ ok: boolean; info: string }> {
  if (isAndroidNative()) {
    try {
      const res = await MiraNative.openApp({ target })
      return { ok: true, info: `Launched ${res.launched || target}` }
    } catch {
      // fall through
    }
  }
  const webMap: Record<string, string> = {
    youtube: 'https://www.youtube.com',
    whatsapp: 'https://web.whatsapp.com',
    spotify: 'https://open.spotify.com',
    maps: 'https://maps.google.com',
    gmail: 'https://mail.google.com',
    chrome: 'https://www.google.com',
    google: 'https://www.google.com',
    chatgpt: 'https://chatgpt.com',
    instagram: 'https://www.instagram.com',
  }
  const lower = target.toLowerCase()
  const matched = Object.keys(webMap).find((k) => lower.includes(k))
  const url = matched ? webMap[matched] : `https://www.google.com/search?q=${encodeURIComponent(target)}`
  window.open(url, '_blank', 'noopener')
  return { ok: true, info: `Opened ${matched || target}` }
}

export async function nativeOpenUrl(url: string) {
  if (isAndroidNative()) {
    try {
      await MiraNative.openUrl({ url })
      return
    } catch {
      // fallback
    }
  }
  window.open(url, '_blank', 'noopener')
}

export async function nativeToggleFlashlight(on?: boolean): Promise<{ ok: boolean; on: boolean; info: string }> {
  if (isAndroidNative()) {
    try {
      const res = await MiraNative.toggleFlashlight({ on })
      return { ok: true, on: res.on, info: res.on ? 'Flashlight turned ON' : 'Flashlight turned OFF' }
    } catch (e) {
      return { ok: false, on: false, info: String(e) }
    }
  }
  return { ok: false, on: Boolean(on), info: 'Hardware flashlight toggle runs inside the Android APK.' }
}

export async function nativeGetBattery(): Promise<{ level: number; charging: boolean } | null> {
  if (isAndroidNative()) {
    try {
      return await MiraNative.getDeviceBattery()
    } catch {
      return null
    }
  }
  try {
    const nav = navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean }> }
    if (nav.getBattery) {
      const b = await nav.getBattery()
      return { level: Math.round(b.level * 100), charging: b.charging }
    }
  } catch {
    // ignore
  }
  return null
}

export async function nativeSetSystemAlarm(hour: number, minute: number, message: string) {
  if (isAndroidNative()) {
    try {
      await MiraNative.setSystemAlarm({ hour, minute, message })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }
  return { ok: false }
}
