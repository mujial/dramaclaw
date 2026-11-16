import type { ModalId, OutfitId, StageId } from '../types/mora'
import {
  nativeGetBattery,
  nativeOpenApp,
  nativeOpenUrl,
  nativeSetLiveWallpaper,
  nativeSetStaticWallpaper,
  nativeSetSystemAlarm,
  nativeToggleFlashlight,
} from './miraNative'

// Classic joke bank integrated from Aryan-0001/Jarvis-AI
const JARVIS_JOKES = [
  "Why don't scientists trust atoms? Because they make up everything!",
  'Why did the scarecrow win an award? Because he was outstanding in his field!',
  'What do you call fake spaghetti? An impasta!',
  'Why don’t programmers like nature? It has too many bugs!',
  'What do you call an alligator in a vest? An investigator!',
  'How do you organize a space party? You planet!',
  'Why did the computer go to the doctor? Because it had a virus!',
  'What do you call a sleeping bull? A bulldozer!',
  'Why did the math book look sad? Because it had too many problems!',
  'What do you get when you cross a snake and a pie? A python!',
  'What did one ocean say to the other ocean? Nothing, they just waved!',
  'Why did the coffee file a police report? It got mugged!',
  'What do you call a fish wearing a bowtie? Sofishticated!',
  'What do you call a snowman with a six-pack? An abdominal snowman!',
  'Why did the cookie go to the hospital? Because it felt crummy!',
]

export interface MiraCommandCallbacks {
  commanderName: string
  outfit: OutfitId
  stage: StageId
  battery: number
  activeGame: string
  onSetOutfit: (outfit: OutfitId) => void
  onSetStage: (stage: StageId) => void
  onOpenModal: (modal: ModalId) => void
  onAddReminder: (title: string, delaySeconds: number) => void
  onAddAlarm: (time: string, label: string) => void
  onSetFlashlight: (on: boolean) => void
  onLogCommand: (command: string, action: string, status: string) => void
}

export interface JarvisRunResult {
  reply: string
  mood: string
  xpGain: number
  executedAction?: string
  usedGemini?: boolean
}

function parseTime12hOr24h(text: string): { hour: number; minute: number; hhmm: string } | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const minute = m[2] ? parseInt(m[2], 10) : 0
  const mer = m[3]?.toLowerCase()
  if (mer === 'pm' && hour < 12) hour += 12
  if (mer === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return { hour, minute, hhmm }
}

async function executeStructuredAction(
  action: string,
  arg: string,
  rawCmd: string,
  cb: MiraCommandCallbacks,
): Promise<string | null> {
  const cleanArg = (arg || '').trim()
  switch (action.toUpperCase()) {
    case 'OPEN_APP': {
      const res = await nativeOpenApp(cleanArg || 'youtube')
      cb.onLogCommand(rawCmd, `OPEN_APP(${cleanArg})`, res.info)
      return res.info
    }
    case 'SEARCH_YOUTUBE': {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanArg)}`
      await nativeOpenUrl(url)
      cb.onLogCommand(rawCmd, `SEARCH_YOUTUBE(${cleanArg})`, 'Opened YouTube')
      return `Searched YouTube for "${cleanArg}"`
    }
    case 'SEARCH_WEB': {
      const url = `https://www.google.com/search?q=${encodeURIComponent(cleanArg)}`
      await nativeOpenUrl(url)
      cb.onLogCommand(rawCmd, `SEARCH_WEB(${cleanArg})`, 'Opened Google Search')
      return `Searched Google for "${cleanArg}"`
    }
    case 'PLAY_MUSIC': {
      await nativeOpenUrl(
        cleanArg
          ? `https://open.spotify.com/search/${encodeURIComponent(cleanArg)}`
          : 'https://open.spotify.com',
      )
      cb.onLogCommand(rawCmd, `PLAY_MUSIC(${cleanArg || 'Spotify'})`, 'Opened Spotify')
      return `Opened Spotify${cleanArg ? ` for ${cleanArg}` : ''}`
    }
    case 'WEATHER': {
      await nativeOpenUrl(`https://www.google.com/search?q=weather+${encodeURIComponent(cleanArg || 'today')}`)
      cb.onLogCommand(rawCmd, 'WEATHER', 'Opened Weather forecast')
      return 'Opened live weather forecast'
    }
    case 'FLASHLIGHT_ON': {
      const res = await nativeToggleFlashlight(true)
      cb.onSetFlashlight(true)
      cb.onLogCommand(rawCmd, 'FLASHLIGHT_ON', res.info)
      return res.info
    }
    case 'FLASHLIGHT_OFF': {
      const res = await nativeToggleFlashlight(false)
      cb.onSetFlashlight(false)
      cb.onLogCommand(rawCmd, 'FLASHLIGHT_OFF', res.info)
      return res.info
    }
    case 'SET_WALLPAPER_LIVE': {
      const res = await nativeSetLiveWallpaper(cb.outfit, cb.stage, cb.commanderName)
      cb.onLogCommand(rawCmd, 'SET_LIVE_WALLPAPER', res.message)
      return res.message
    }
    case 'SET_WALLPAPER_STATIC': {
      const res = await nativeSetStaticWallpaper(cb.outfit, cb.stage, cb.commanderName)
      cb.onLogCommand(rawCmd, 'SET_STATIC_WALLPAPER', res.message)
      return res.message
    }
    case 'SWITCH_OUTFIT': {
      const lower = cleanArg.toLowerCase()
      const next: OutfitId = lower.includes('academy')
        ? 'academy'
        : lower.includes('esports') || lower.includes('pilot')
          ? 'esports'
          : lower.includes('chibi') || lower.includes('buddy')
            ? 'chibi'
            : 'cyber'
      cb.onSetOutfit(next)
      cb.onLogCommand(rawCmd, `SWITCH_OUTFIT(${next})`, 'Outfit changed')
      return `Switched outfit to ${next}`
    }
    case 'SWITCH_STAGE': {
      const lower = cleanArg.toLowerCase()
      const next: StageId = lower.includes('lab')
        ? 'lab'
        : lower.includes('arena')
          ? 'arena'
          : 'space'
      cb.onSetStage(next)
      cb.onLogCommand(rawCmd, `SWITCH_STAGE(${next})`, 'Stage changed')
      return `Switched stage to ${next}`
    }
    case 'OPEN_MODAL': {
      const lower = cleanArg.toLowerCase()
      const modal: ModalId = lower.includes('game')
        ? 'gamespace'
        : lower.includes('dress')
          ? 'dressup'
          : lower.includes('care')
            ? 'care'
            : lower.includes('tech')
              ? 'tech'
              : lower.includes('live')
                ? 'live'
                : lower.includes('ar') || lower.includes('camera')
                  ? 'ar'
                  : lower.includes('charg')
                    ? 'charging'
                    : lower.includes('alarm')
                      ? 'alarm'
                      : lower.includes('jarvis') || lower.includes('gemini')
                        ? 'jarvis'
                        : null
      if (modal) {
        cb.onOpenModal(modal)
        cb.onLogCommand(rawCmd, `OPEN_MODAL(${modal})`, 'Opened panel')
        return `Opened ${modal}`
      }
      return null
    }
    case 'SET_TIMER': {
      const secs = Math.max(5, parseInt(cleanArg, 10) || 60)
      cb.onAddReminder('MIRA Countdown Timer', secs)
      cb.onLogCommand(rawCmd, `SET_TIMER(${secs}s)`, 'Timer running')
      return `Set timer for ${secs}s`
    }
    case 'SET_ALARM': {
      const parsed = parseTime12hOr24h(cleanArg) || { hour: 7, minute: 30, hhmm: '07:30' }
      cb.onAddAlarm(parsed.hhmm, 'MIRA Wake-Up Call')
      await nativeSetSystemAlarm(parsed.hour, parsed.minute, 'MIRA Wake-Up Call')
      cb.onLogCommand(rawCmd, `SET_ALARM(${parsed.hhmm})`, 'Alarm scheduled')
      return `Alarm set for ${parsed.hhmm}`
    }
    default:
      return null
  }
}

async function tryLocalJarvisCommand(
  input: string,
  cb: MiraCommandCallbacks,
): Promise<JarvisRunResult | null> {
  const lower = input.toLowerCase().trim()

  // Time
  if (/\b(what('?s| is)? the time|current time|time kya|kitne baje)\b/i.test(lower)) {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    cb.onLogCommand(input, 'GET_TIME', now)
    return {
      reply: `The current time is ${now}, ${cb.commanderName}.`,
      mood: 'tactical',
      xpGain: 10,
      executedAction: `Time: ${now}`,
    }
  }

  // Date
  if (/\b(today'?s date|date today|aaj ki tarikh|what day is)\b/i.test(lower)) {
    const d = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    cb.onLogCommand(input, 'GET_DATE', d)
    return {
      reply: `Today is ${d}, ${cb.commanderName}.`,
      mood: 'happy',
      xpGain: 10,
      executedAction: `Date: ${d}`,
    }
  }

  // Joke
  if (/\b(tell.*joke|joke sunao|make me laugh)\b/i.test(lower)) {
    const joke = JARVIS_JOKES[Math.floor(Math.random() * JARVIS_JOKES.length)]
    cb.onLogCommand(input, 'TELL_JOKE', 'Delivered joke')
    return { reply: joke, mood: 'excited', xpGain: 12, executedAction: 'Jarvis Joke' }
  }

  // Battery check
  if (/\b(battery level|battery percentage|check battery|kitna charge)\b/i.test(lower)) {
    const realBat = await nativeGetBattery()
    const pct = realBat?.level ?? cb.battery
    const chg = realBat?.charging ? 'and currently charging' : 'on battery power'
    cb.onLogCommand(input, 'BATTERY_CHECK', `${pct}%`)
    return {
      reply: `Your device battery is at ${pct}% ${chg}, ${cb.commanderName}.`,
      mood: 'caring',
      xpGain: 12,
      executedAction: `Battery ${pct}%`,
    }
  }

  // Flashlight
  if (/\b(torch|flashlight)\b/i.test(lower)) {
    const turnOn = !/\b(off|band|close|disable)\b/i.test(lower)
    const msg = await executeStructuredAction(
      turnOn ? 'FLASHLIGHT_ON' : 'FLASHLIGHT_OFF',
      '',
      input,
      cb,
    )
    return {
      reply: `${msg || 'Flashlight toggled'}, ${cb.commanderName}!`,
      mood: 'tactical',
      xpGain: 15,
      executedAction: msg || 'Flashlight',
    }
  }

  // Wallpaper command
  if (/\b(wallpaper|background set|home screen set)\b/i.test(lower)) {
    const isLive = /\b(live|animated|moving)\b/i.test(lower)
    const msg = await executeStructuredAction(
      isLive ? 'SET_WALLPAPER_LIVE' : 'SET_WALLPAPER_STATIC',
      '',
      input,
      cb,
    )
    return {
      reply: `${msg}! Looking iconic on your mobile screen, ${cb.commanderName}!`,
      mood: 'excited',
      xpGain: 25,
      executedAction: msg || 'Wallpaper',
    }
  }

  // Timer
  const timerMatch = lower.match(/(?:set\s+)?timer(?:\s+for)?\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)/i)
  if (timerMatch) {
    const num = parseInt(timerMatch[1], 10)
    const secs = timerMatch[2].startsWith('m') ? num * 60 : num
    const msg = await executeStructuredAction('SET_TIMER', String(secs), input, cb)
    return {
      reply: `MIRA Timer locked for ${num} ${timerMatch[2].startsWith('m') ? 'minute(s)' : 'seconds'}, ${cb.commanderName}!`,
      mood: 'tactical',
      xpGain: 18,
      executedAction: msg || 'Timer',
    }
  }

  // Alarm
  if (/\bset alarm\b/i.test(lower)) {
    const parsed = parseTime12hOr24h(lower)
    if (parsed) {
      const msg = await executeStructuredAction('SET_ALARM', lower, input, cb)
      return {
        reply: `Alarm scheduled for ${parsed.hhmm}, ${cb.commanderName}. Snooze Scold Mode is armed!`,
        mood: 'tsundere',
        xpGain: 20,
        executedAction: msg || 'Alarm',
      }
    }
  }

  // YouTube search
  const ytMatch = lower.match(/(?:search|play)\s+(.+?)\s+on\s+youtube/i)
  if (ytMatch) {
    const q = ytMatch[1].trim()
    const msg = await executeStructuredAction('SEARCH_YOUTUBE', q, input, cb)
    return {
      reply: `Opening YouTube for "${q}", ${cb.commanderName}!`,
      mood: 'excited',
      xpGain: 15,
      executedAction: msg || 'YouTube',
    }
  }

  // Play music / Spotify
  if (/\b(play music|open spotify|gaana bajao)\b/i.test(lower)) {
    const msg = await executeStructuredAction('PLAY_MUSIC', '', input, cb)
    return {
      reply: `Opening Spotify for you, ${cb.commanderName}!`,
      mood: 'happy',
      xpGain: 15,
      executedAction: msg || 'Spotify',
    }
  }

  // Weather
  if (/\b(weather|mausam)\b/i.test(lower)) {
    const msg = await executeStructuredAction('WEATHER', '', input, cb)
    return {
      reply: `Opening today's weather forecast for you, ${cb.commanderName}!`,
      mood: 'caring',
      xpGain: 15,
      executedAction: msg || 'Weather',
    }
  }

  // Open App (JarvisAppFlutter appMap!)
  const openMatch = lower.match(/^(?:please\s+)?open\s+(.+)$/i)
  if (openMatch) {
    const target = openMatch[1].trim()
    if (/^(game\s*space|dress\s*up|care|science|tech|mira\s*live|ar\s*camera|charging|alarm|jarvis|gemini)/i.test(target)) {
      const msg = await executeStructuredAction('OPEN_MODAL', target, input, cb)
      return {
        reply: `Opening ${target} inside MIRA AI!`,
        mood: 'excited',
        xpGain: 15,
        executedAction: msg || target,
      }
    }
    const msg = await executeStructuredAction('OPEN_APP', target, input, cb)
    return {
      reply: `Executing Jarvis command: ${msg}, ${cb.commanderName}!`,
      mood: 'tactical',
      xpGain: 20,
      executedAction: msg || `Open ${target}`,
    }
  }

  // Search Google
  const searchMatch = lower.match(/^(?:search|google)\s+(.+)$/i)
  if (searchMatch) {
    const q = searchMatch[1].trim()
    const msg = await executeStructuredAction('SEARCH_WEB', q, input, cb)
    return {
      reply: `Searching Google for "${q}", ${cb.commanderName}!`,
      mood: 'tactical',
      xpGain: 15,
      executedAction: msg || 'Web Search',
    }
  }

  // Simple math calculator
  const calcMatch = lower.match(/^(?:calculate|calc|solve)?\s*([\d.\s+\-*/()]+)$/)
  if (calcMatch && /[+\-*/]/.test(calcMatch[1])) {
    try {
      const expr = calcMatch[1].replace(/[^0-9+\-*/().\s]/g, '')
      const result = Function(`"use strict"; return (${expr})`)()
      if (typeof result === 'number' && Number.isFinite(result)) {
        cb.onLogCommand(input, 'CALCULATE', String(result))
        return {
          reply: `${expr.trim()} equals ${result}, ${cb.commanderName}.`,
          mood: 'tactical',
          xpGain: 12,
          executedAction: `= ${result}`,
        }
      }
    } catch {
      // ignore invalid math
    }
  }

  return null
}

async function callRealGemini(
  input: string,
  apiKey: string,
  model: string,
  cb: MiraCommandCallbacks,
): Promise<JarvisRunResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`

  const systemPrompt = `You are MIRA (Mobile Intelligent Robotic Assistant), the user's personal cybernetic anime AI companion inspired by futuristic 2122 gaming assistants AND powered by the Jarvis-AI command core.
User's name: ${cb.commanderName}. Active outfit: ${cb.outfit}. Active stage: ${cb.stage}. Active game: ${cb.activeGame}. Battery: ${cb.battery}%.
You can speak English and Hinglish naturally, keep responses concise (1-3 sentences, clean plain text with no asterisks or tildes so TTS reads smoothly).
If the user asks to perform a real device or app action, include a command tag at the very end of your response in this exact format:
[[ACTION:TYPE|ARGUMENT]]
Supported TYPE values:
- OPEN_APP (e.g. [[ACTION:OPEN_APP|youtube]] or whatsapp, chrome, camera, settings, spotify, maps, pubg, free fire, instagram)
- SEARCH_YOUTUBE (e.g. [[ACTION:SEARCH_YOUTUBE|phonk gaming mix]])
- SEARCH_WEB (e.g. [[ACTION:SEARCH_WEB|weather today]])
- PLAY_MUSIC (e.g. [[ACTION:PLAY_MUSIC|believer]])
- WEATHER ([[ACTION:WEATHER|today]])
- FLASHLIGHT_ON ([[ACTION:FLASHLIGHT_ON|]])
- FLASHLIGHT_OFF ([[ACTION:FLASHLIGHT_OFF|]])
- SET_WALLPAPER_LIVE ([[ACTION:SET_WALLPAPER_LIVE|]])
- SET_WALLPAPER_STATIC ([[ACTION:SET_WALLPAPER_STATIC|]])
- SWITCH_OUTFIT (cyber, academy, esports, chibi)
- SWITCH_STAGE (space, lab, arena)
- OPEN_MODAL (gamespace, dressup, care, tech, live, ar, charging, alarm, jarvis)
- SET_TIMER (seconds as integer, e.g. [[ACTION:SET_TIMER|60]])
- SET_ALARM (HH:MM 24h, e.g. [[ACTION:SET_ALARM|07:30]])
Only add [[ACTION:...]] when the user genuinely wants an action executed.`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 320 },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 140)}`)
  }

  const json = await res.json()
  let rawText: string =
    json?.candidates?.[0]?.content?.parts?.[0]?.text ||
    `Neural link received your message, ${cb.commanderName}!`

  let executedAction: string | undefined
  const cmdMatch = rawText.match(/\[\[ACTION:([A-Z_]+)\|([^\]]*)\]\]/)
  if (cmdMatch) {
    rawText = rawText.replace(cmdMatch[0], '').trim()
    const outcome = await executeStructuredAction(cmdMatch[1], cmdMatch[2], input, cb)
    if (outcome) executedAction = outcome
  } else {
    cb.onLogCommand(input, `GEMINI(${model})`, 'Answered')
  }

  return {
    reply: rawText.replace(/[*~`]/g, '').trim(),
    mood: 'happy',
    xpGain: 22,
    executedAction,
    usedGemini: true,
  }
}

export async function runMiraJarvisCommand(
  input: string,
  options: { geminiApiKey: string; geminiModel: string },
  cb: MiraCommandCallbacks,
): Promise<JarvisRunResult> {
  // 1. Check fast deterministic Jarvis commands first (Open App, Flashlight, Wallpaper, Time, Joke, Timer, Alarm...)
  const localCmd = await tryLocalJarvisCommand(input, cb)
  if (localCmd) return localCmd

  // 2. If user provided a Gemini API key, run real Google Gemini AI + action execution!
  if (options.geminiApiKey && options.geminiApiKey.trim().length > 10) {
    try {
      return await callRealGemini(input, options.geminiApiKey, options.geminiModel, cb)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      cb.onLogCommand(input, 'GEMINI_ERROR', msg)
      return {
        reply: `Gemini API error: ${msg}. Please check your Gemini API Key in Jarvis & Gemini Hub!`,
        mood: 'caring',
        xpGain: 5,
      }
    }
  }

  // 3. Fallback to MIRA 2122 offline brain if no Gemini key yet
  const lower = input.toLowerCase()
  if (/(2122|backstory|lore|who are you|kaun ho|name)/i.test(lower)) {
    return {
      reply: `I am MIRA, your personal cybernetic AI companion from 2122, upgraded with Jarvis-AI command control! Add your Gemini API key in the Jarvis & Gemini hub to unlock full real-world AI reasoning!`,
      mood: 'lore',
      xpGain: 15,
    }
  }
  return {
    reply: `Copy that, ${cb.commanderName}! Tip: add your Gemini API key in Jarvis & Gemini Hub so I can answer anything with real Google Gemini AI and run smart commands!`,
    mood: 'happy',
    xpGain: 12,
  }
}
