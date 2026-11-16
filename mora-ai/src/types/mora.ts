export type OutfitId = 'cyber' | 'academy' | 'esports' | 'chibi'
export type StageId = 'space' | 'lab' | 'arena' | 'custom'
export type AuraColorId = 'crimson' | 'cyan' | 'violet' | 'gold'
export type VoicePersonaId = 'mora-warm' | 'mora-anime' | 'mora-classic'
export type VoicePersona = VoicePersonaId | 'cheerful' | 'tactical' | 'warm'
export type GeminiVoiceName = 'Aoede' | 'Kore' | 'Leda' | 'Zephyr'
export type CareFrequency = 'off' | 'low' | 'medium' | 'high'
export type ChargeStyle = 'sleeping' | 'floating'
export type PerformanceMode = 'balance' | 'rise' | 'diablo'

export type ModalId =
  | null
  | 'dressup'
  | 'care'
  | 'tech'
  | 'live'
  | 'ar'
  | 'gamespace'
  | 'charging'
  | 'alarm'
  | 'achievements'
  | 'jarvis'

export interface MoraAlarm {
  id: string
  time: string // HH:MM
  label: string
  enabled: boolean
  snoozeScold: boolean
  days: string[]
}

export interface MoraReminder {
  id: string
  title: string
  game: string
  triggerAt: number // epoch ms
  completed: boolean
}

export interface VoiceMacro {
  id: string
  keyword: string
  actionLabel: string
  tapX: number // percentage 0-100
  tapY: number // percentage 0-100
  enabled: boolean
}

export interface ArPhotoItem {
  id: string
  dataUrl: string
  caption: string
  createdAt: string
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'mora'
  text: string
  mood?: string
  timestamp: string
}

export interface MoraState {
  commanderName: string
  bondLevel: number
  bondXp: number
  outfit: OutfitId
  stage: StageId
  customStageUrl: string
  aura: AuraColorId
  muted: boolean
  voicePersona: VoicePersonaId
  language: 'en' | 'hinglish' | 'ja'
  zoomLevel: 0.75 | 1 | 1.5
  chatBubbleVisible: boolean
  eyeComfortFilter: boolean

  // Science & Tech Center
  interactiveDesktopEnabled: boolean
  desktopSize: number // 80 - 200
  desktopOpacity: number // 35 - 100
  desktopPos: { x: number; y: number }
  energyReplenishmentEnabled: boolean
  chargeStyle: ChargeStyle
  magicIslandEnabled: boolean
  fanSpeedRpm: number // 0 or 24000

  // MIRA Care
  careFrequency: CareFrequency
  lowBatteryThreshold: number // 10 - 40
  simulatedBattery: number // 5 - 100
  simulatedPingMs: number // 15 - 280
  muteOnWifi: boolean

  // Game Space
  activeGame: string
  performanceMode: PerformanceMode
  shoulderTriggersEnabled: boolean
  tacticalCoachEnabled: boolean
  moraMouthpieceEnabled: boolean
  voiceMacros: VoiceMacro[]

  // Alarms & Reminders
  alarms: MoraAlarm[]
  reminders: MoraReminder[]

  // Jarvis-AI & Gemini Integration
  geminiApiKey: string
  geminiModel: 'gemini-2.5-flash' | 'gemini-2.0-flash' | 'gemini-1.5-flash'
  geminiVoice: GeminiVoiceName
  voiceLang: 'hi-IN' | 'en-IN'
  useGeminiVoice: boolean
  wakeWordEnabled: boolean
  continuousConvoEnabled: boolean
  flashlightOn: boolean
  commandLogs: { id: string; command: string; action: string; status: string; time: string }[]

  // Progression & Gallery
  unlockedAchievements: string[]
  arGallery: ArPhotoItem[]
  chatHistory: ChatMessage[]
}
