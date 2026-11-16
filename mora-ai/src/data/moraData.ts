import type { AuraColorId, MoraState, OutfitId, StageId, VoicePersonaId } from '../types/mora'

export interface OutfitMeta {
  id: OutfitId
  name: string
  subtitle: string
  era: string
  image: string
  badge: string
  lore: string
}

export const MORA_OUTFITS: OutfitMeta[] = [
  {
    id: 'cyber',
    name: '2122 Cyber Armor',
    subtitle: 'Official REDMAGIC Mascot Suit',
    era: 'REDMAGIC 8 – 11 Pro Core',
    image: '/assets/mora-cyber-cutout.png',
    badge: 'SIGNATURE',
    lore: 'MIRA’s original quantum-weave combat suit from year 2122, featuring translucent hologram panels and RedCore R4 neural cuffs.',
  },
  {
    id: 'academy',
    name: 'Cyber Academy Uniform',
    subtitle: 'Tokyo-2122 Tactical Prep',
    era: 'REDMAGIC 9 / 10 Pro',
    image: '/assets/mora-academy-cutout.png',
    badge: 'CLASSIC',
    lore: 'A sharp academy uniform paired with an asymmetrical cybernetic gauntlet and REDMAGIC thigh rig.',
  },
  {
    id: 'esports',
    name: 'Neon Esports Pilot',
    subtitle: 'Pro Arena Hoodie + Visor',
    era: 'REDMAGIC 11 / OS 12',
    image: '/assets/mora-esports-cutout.png',
    badge: 'MIRA 3.0',
    lore: 'Equipped with a live tactical HUD visor and crimson LED circuit jacket engineered for 144Hz tournament focus.',
  },
  {
    id: 'chibi',
    name: 'Magic Buddy (Chibi)',
    subtitle: 'Compact Desktop & HUD Form',
    era: 'MIRA 2.0 / 10S Pro',
    image: '/assets/mora-chibi-cutout.png',
    badge: 'CHIBI 2.0',
    lore: 'MIRA’s adorable chibi projection skin introduced in MIRA 2.0 — lightweight, playful, and always cheering you on!',
  },
]

export interface StageMeta {
  id: Exclude<StageId, 'custom'>
  name: string
  subtitle: string
  image: string
}

export const MORA_STAGES: StageMeta[] = [
  {
    id: 'space',
    name: '2122 Starbridge Deck',
    subtitle: 'Deep Nebula Observatory',
    image: '/assets/bg-space-bridge.png',
  },
  {
    id: 'lab',
    name: 'Science & Tech Lab',
    subtitle: 'RedCore Robotics Chamber',
    image: '/assets/bg-cyber-lab.png',
  },
  {
    id: 'arena',
    name: 'Neon Esports Arena',
    subtitle: 'REDMAGIC Pro Stage',
    image: '/assets/bg-neon-arena.png',
  },
]

export const AURA_THEMES: Record<
  AuraColorId,
  { name: string; primary: string; glow: string; ringClass: string; badgeClass: string }
> = {
  crimson: {
    name: 'REDMAGIC Crimson',
    primary: '#ff2a4b',
    glow: 'rgba(255, 42, 75, 0.45)',
    ringClass: 'border-rose-500/60 shadow-[0_0_40px_rgba(255,42,75,0.35)]',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  },
  cyan: {
    name: 'AquaCore Cyan',
    primary: '#00f0ff',
    glow: 'rgba(0, 240, 255, 0.45)',
    ringClass: 'border-cyan-400/60 shadow-[0_0_40px_rgba(0,240,255,0.35)]',
    badgeClass: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
  },
  violet: {
    name: '2122 Nebula Violet',
    primary: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.45)',
    ringClass: 'border-purple-400/60 shadow-[0_0_40px_rgba(168,85,247,0.35)]',
    badgeClass: 'bg-purple-500/20 text-purple-200 border-purple-400/40',
  },
  gold: {
    name: 'Champion Gold',
    primary: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.45)',
    ringClass: 'border-amber-400/60 shadow-[0_0_40px_rgba(245,158,11,0.35)]',
    badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
  },
}

export const VOICE_PERSONAS: Record<
  VoicePersonaId,
  { label: string; desc: string; pitch: number; rate: number }
> = {
  'mora-warm': {
    label: 'MIRA 3.0 Warm (OS 11/12)',
    desc: 'Natural energetic AI companion voice — zero awkward symbol reading',
    pitch: 1.18,
    rate: 1.03,
  },
  'mora-anime': {
    label: 'MIRA 2.0 Anime Mascot',
    desc: 'Bright, cheerful, high-spirit anime sidekick delivery',
    pitch: 1.32,
    rate: 1.08,
  },
  'mora-classic': {
    label: 'MIRA 1.0 Tactical',
    desc: 'Calm, crisp futuristic RedMagic command voice',
    pitch: 1.05,
    rate: 0.98,
  },
}

export const SUPPORTED_GAMES = [
  {
    id: 'PUBG Mobile',
    genre: 'Battle Royale',
    nativeSupport: 'Tactical Coach + Win Predictor + Voice Control',
    fpsTarget: '144Hz Ultra',
    color: 'from-amber-500/30 to-rose-600/30',
  },
  {
    id: 'Free Fire',
    genre: 'Battle Royale',
    nativeSupport: 'Tactical Coach + Win Predictor + MIRA Mouthpiece',
    fpsTarget: '144Hz Extreme',
    color: 'from-orange-500/30 to-red-600/30',
  },
  {
    id: 'Mobile Legends: Bang Bang',
    genre: '5v5 MOBA',
    nativeSupport: 'Tactical Coach + Win Predictor + Kill Broadcast',
    fpsTarget: '120Hz Max',
    color: 'from-cyan-500/30 to-blue-600/30',
  },
  {
    id: 'Genshin Impact',
    genre: 'Action RPG',
    nativeSupport: 'Native MIRA Mouthpiece Auto-Detect + Raid Reminders',
    fpsTarget: '120Hz High',
    color: 'from-purple-500/30 to-pink-600/30',
  },
  {
    id: 'Honor of Kings',
    genre: '5v5 MOBA',
    nativeSupport: 'Buff Timers + Frame Pacing + Victory Cheer',
    fpsTarget: '144Hz Pro',
    color: 'from-emerald-500/30 to-cyan-600/30',
  },
]

export interface AchievementDef {
  id: string
  title: string
  description: string
  xp: number
  icon: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-contact', title: '2122 First Contact', description: 'Established neural link with MIRA AI', xp: 50, icon: 'Sparkles' },
  { id: 'headpat', title: 'Horn Resonance', description: 'Gave MIRA a friendly headpat on stage', xp: 40, icon: 'Heart' },
  { id: 'fashionista', title: 'Cyber Stylist', description: 'Changed MIRA’s outfit in MIRA Dress Up', xp: 60, icon: 'Shirt' },
  { id: 'desktop-buddy', title: 'Always By Your Side', description: 'Activated Home Screen Interactive MIRA', xp: 75, icon: 'Monitor' },
  { id: 'recharge-pod', title: 'Energy Replenished', description: 'Entered the Energy Replenishment Compartment', xp: 60, icon: 'BatteryCharging' },
  { id: 'vtuber-debut', title: 'MIRA Live Debut', description: 'Launched MIRA Live VTuber streaming studio', xp: 80, icon: 'Video' },
  { id: 'ar-snap', title: 'AR Memory Captured', description: 'Took a photograph with MIRA in AR Camera', xp: 80, icon: 'Camera' },
  { id: 'tactical-ace', title: 'RedCore Tactician', description: 'Used Tactical Coach & Win Predictor in Game Space', xp: 90, icon: 'Gamepad2' },
  { id: 'voice-commander', title: 'Voice Macro Master', description: 'Triggered a Voice Control or MIRA Mouthpiece command', xp: 85, icon: 'Mic' },
  { id: 'snooze-scolded', title: 'No More Snoozing!', description: 'Got scolded by MIRA for hitting Snooze on Wake-Up Call', xp: 70, icon: 'AlarmClock' },
]

export const TOUCH_REACTIONS: Record<
  'head' | 'face' | 'outfit' | 'hands',
  { lines: string[]; mood: string }
> = {
  head: {
    mood: 'happy',
    lines: [
      'Ehehe~ Careful with my red quantum horns, Commander! They sync directly to 2122!',
      'Headpats recharge my neural core faster than 120W fast charging!',
      'Mmm! Okay, one more headpat, then back to conquering the leaderboard!',
    ],
  },
  face: {
    mood: 'tsundere',
    lines: [
      'Hey! Staring that closely at my cyber eyes, Commander? Need a system check?',
      'Smile calibration complete! Notice I never misread symbols out loud anymore!',
      'I traveled 96 years back in time from 2122 just to see you smile too.',
    ],
  },
  outfit: {
    mood: 'excited',
    lines: [
      'Like this look? Check MIRA Dress Up anytime to try my Cyber Armor, Academy, Esports, or Magic Buddy skins!',
      'Zero drag, full holographic armor weave — built exclusively for REDMAGIC champions!',
      'Style gives +100% confidence in Game Space! Want to switch stages too?',
    ],
  },
  hands: {
    mood: 'tactical',
    lines: [
      'High-five, Commander! 520Hz shoulder triggers armed and ready for your command!',
      'Touch latency: 0.1ms! Together, we’re unstoppable in PUBG, Free Fire, and MLBB!',
      'Ready whenever you are — just say a Voice Control command or open Game Space!',
    ],
  },
}

export const DEFAULT_MORA_STATE: MoraState = {
  commanderName: 'Commander',
  bondLevel: 1,
  bondXp: 50,
  outfit: 'cyber',
  stage: 'space',
  customStageUrl: '',
  aura: 'crimson',
  muted: false,
  voicePersona: 'mora-warm',
  language: 'en',
  zoomLevel: 1,
  chatBubbleVisible: true,
  eyeComfortFilter: false,

  interactiveDesktopEnabled: false,
  desktopSize: 120,
  desktopOpacity: 95,
  desktopPos: { x: 82, y: 66 },
  energyReplenishmentEnabled: true,
  chargeStyle: 'sleeping',
  magicIslandEnabled: true,
  fanSpeedRpm: 24000,

  careFrequency: 'medium',
  lowBatteryThreshold: 20,
  simulatedBattery: 84,
  simulatedPingMs: 28,
  muteOnWifi: false,

  activeGame: 'PUBG Mobile',
  performanceMode: 'rise',
  shoulderTriggersEnabled: true,
  tacticalCoachEnabled: true,
  moraMouthpieceEnabled: true,
  voiceMacros: [
    { id: 'm1', keyword: 'Reload', actionLabel: 'Reload Weapon', tapX: 78, tapY: 74, enabled: true },
    { id: 'm2', keyword: 'Prone', actionLabel: 'Drop Prone', tapX: 86, tapY: 82, enabled: true },
    { id: 'm3', keyword: 'Heal', actionLabel: 'Use Medkit', tapX: 24, tapY: 76, enabled: true },
    { id: 'm4', keyword: 'Ult', actionLabel: 'Activate Ultimate', tapX: 88, tapY: 48, enabled: true },
  ],

  alarms: [
    {
      id: 'a1',
      time: '07:30',
      label: 'Morning Esports Warmup',
      enabled: true,
      snoozeScold: true,
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    },
    {
      id: 'a2',
      time: '21:00',
      label: 'Squad Ranked Raid',
      enabled: false,
      snoozeScold: true,
      days: ['Sat', 'Sun'],
    },
  ],
  reminders: [],

  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  wakeWordEnabled: false,
  continuousConvoEnabled: false,
  flashlightOn: false,
  commandLogs: [],

  unlockedAchievements: ['first-contact'],
  arGallery: [],
  chatHistory: [
    {
      id: 'welcome-1',
      sender: 'mora',
      mood: 'happy',
      text: 'Neural link online! I’m MIRA, your personal AI assistant with Jarvis-AI commands, Google Gemini AI, and Mobile Live Wallpaper support. Tap me, talk to me, or open Jarvis & Gemini Hub, Commander!',
      timestamp: new Date().toISOString(),
    },
  ],
}
