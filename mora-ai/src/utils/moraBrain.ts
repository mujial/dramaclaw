export interface LocalChatPayload {
  message: string
  commanderName: string
  outfit: string
  bondLevel: number
  battery: number
  activeGame: string
}

export function localMoraReply(payload: LocalChatPayload) {
  const msg = payload.message.trim()
  const lower = msg.toLowerCase()
  const cmd = payload.commanderName || 'Commander'
  const outfit = payload.outfit || 'cyber'
  const battery = payload.battery ?? 84
  const game = payload.activeGame || 'PUBG Mobile'

  const remindMatch = lower.match(
    /remind(?:\s+me)?(?:\s+about|\s+to)?\s+(.+?)(?:\s+in\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes))?$/i,
  )
  let createdReminder: { title: string; delaySeconds: number } | null = null
  if (lower.includes('remind') && remindMatch) {
    const num = remindMatch[2] ? parseInt(remindMatch[2], 10) : 30
    const unit = remindMatch[3] || 's'
    const delaySeconds = unit.startsWith('m') ? num * 60 : num
    const title = remindMatch[1]?.replace(/^(to|about)\s+/i, '').trim() || 'In-Game Raid Alert'
    createdReminder = { title, delaySeconds: Math.min(3600, Math.max(5, delaySeconds)) }
  }

  let reply = ''
  let mood = 'happy'
  let xpGain = 15

  if (createdReminder) {
    mood = 'tactical'
    xpGain = 25
    reply = `Roger that, ${cmd}! MIRA Mouthpiece locked your reminder: "${createdReminder.title}" in ${createdReminder.delaySeconds} seconds!`
  } else if (/(2122|backstory|lore|origin|time travel|who are you|kaun ho)/i.test(lower)) {
    mood = 'lore'
    xpGain = 20
    reply = `I'm MIRA, your REDMAGIC AI companion who traveled back from year 2122! I came back to make sure ${cmd} dominates every arena with zero lag and maximum style.`
  } else if (/(outfit|dress|skin|cloth|kapde|look|cute|chibi)/i.test(lower)) {
    mood = 'excited'
    xpGain = 18
    const names: Record<string, string> = {
      cyber: '2122 Cyber Armor',
      academy: 'Cyber Academy Uniform',
      esports: 'Neon Esports Pilot',
      chibi: 'Magic Buddy Chibi 2.0',
    }
    reply = `Ehehe, you noticed my ${names[outfit] || 'outfit'}! Open MIRA Dress Up anytime to try all 4 skins and stages!`
  } else if (/(battery|charge|charging|power|energy)/i.test(lower)) {
    mood = 'caring'
    reply = `Current power core is at ${battery}%. ${
      battery <= 25
        ? 'Warning! Plug into the Energy Replenishment Compartment right away!'
        : 'AquaCore thermals look great. Try Energy Replenishment mode anytime!'
    }`
  } else if (/(game|pubg|free fire|mlbb|genshin|honor|coach|strategy|win|tip|fps|lag|ping)/i.test(lower)) {
    mood = 'tactical'
    xpGain = 20
    reply = `Tactical Coach online for ${game}! Lock 144Hz, spin the 24,000 RPM fan, and use 520Hz shoulder triggers. Check Game Space for your live Win Rate Predictor!`
  } else if (/(alarm|wake|morning|utha|sleep|snooze)/i.test(lower)) {
    mood = 'tsundere'
    reply = `Hmph! If you hit Snooze on MIRA Wake-Up Call, I will scold you at full volume, ${cmd}!`
  } else if (/(namaste|hello|hi|hey|bro|kaise ho|kya haal|how are you|mora)/i.test(lower)) {
    mood = 'happy'
    reply = `Hey ${cmd}! Neural link synced at 100%! Ready for Game Space, AR Camera, MIRA Live, or just hanging out!`
  } else {
    reply = `Copy that, ${cmd}! Logged "${msg}" in my 2122 tactical core. Want a ${game} coaching tip or a raid reminder?`
  }

  return { reply, mood, xpGain, createdReminder, timestamp: new Date().toISOString() }
}

export function localCoachAnalysis(game: string, kills: number, deaths: number, assists: number) {
  const d = Math.max(1, deaths)
  const ratio = (kills + assists * 0.6) / d
  const winProbability = Math.min(96, Math.max(18, Math.round(42 + ratio * 11)))
  const tips: Record<string, string[]> = {
    'PUBG Mobile': [
      'High-ground rotation favored: hug ridge cover before Zone 4 shrinks.',
      'Switch 520Hz Right Trigger to burst-peek; keep smoke grenades ready.',
      'Pre-aim window angle and activate Diablo Mode for steady 144fps.',
    ],
    'Free Fire': [
      'Drop Gloo Wall immediately after first headshot exchange and strafe left.',
      'Pair active skill cooldown with shotgun rush at close compound range.',
    ],
    'Mobile Legends: Bang Bang': [
      'Lord spawns in 25s — clear mid wave first and zone enemy jungler.',
      'Gold lead supports aggressive turret push; save flicker for backline dive.',
    ],
    'Genshin Impact': [
      'Trigger Elemental Burst rotation now while resonance buffs are active!',
      'Dash-cancel heavy attack animation to preserve stamina for boss AoE.',
    ],
    'Honor of Kings': [
      'Tyrant buff contested — group at river bush and hold crowd-control skill.',
      'Split-push side lane pressure will force enemy defenders off mid.',
    ],
  }
  const pool = tips[game] || tips['PUBG Mobile']
  return {
    game,
    winProbability,
    tip: pool[Math.floor(Math.random() * pool.length)],
    thermalStatus: '36.4°C Optimal (AquaCore + 24,000 RPM Fan)',
  }
}
