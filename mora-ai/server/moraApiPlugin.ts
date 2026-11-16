import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const STATE_FILE = path.join(DATA_DIR, 'mora-state.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readPersistedState(): Record<string, unknown> | null {
  try {
    ensureDataDir()
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8')
      return JSON.parse(raw)
    }
  } catch {
    // ignore corrupt state
  }
  return null
}

function writePersistedState(state: Record<string, unknown>) {
  ensureDataDir()
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

interface ChatPayload {
  message?: string
  commanderName?: string
  outfit?: string
  bondLevel?: number
  battery?: number
  activeGame?: string
  language?: string
}

function generateMoraReply(payload: ChatPayload) {
  const msg = (payload.message || '').trim()
  const lower = msg.toLowerCase()
  const cmd = payload.commanderName || 'Commander'
  const outfit = payload.outfit || 'cyber'
  const battery = payload.battery ?? 86
  const game = payload.activeGame || 'PUBG Mobile'

  // Check if user wants a reminder
  const remindMatch = lower.match(/remind(?:\s+me)?(?:\s+about|\s+to)?\s+(.+?)(?:\s+in\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes))?$/i)
  let createdReminder: { title: string; delaySeconds: number } | null = null
  if (lower.includes('remind') && remindMatch) {
    const num = remindMatch[2] ? parseInt(remindMatch[2], 10) : 30
    const unit = remindMatch[3] || 's'
    const delaySeconds = unit.startsWith('m') ? num * 60 : num
    const title = remindMatch[1]?.replace(/^(to|about)\s+/i, '').trim() || 'In-Game Raid Alert'
    createdReminder = { title, delaySeconds: Math.min(3600, Math.max(5, delaySeconds)) }
  }

  let reply = ''
  let mood: 'happy' | 'excited' | 'tactical' | 'caring' | 'lore' | 'tsundere' = 'happy'
  let xpGain = 15

  if (createdReminder) {
    mood = 'tactical'
    xpGain = 25
    reply = `Roger that, ${cmd}! Mora Mouthpiece has locked in your reminder: "${createdReminder.title}" in ${createdReminder.delaySeconds} seconds. I'll broadcast a voice alert right on time so you never miss a beat!`
  } else if (/(2122|backstory|lore|origin|time travel|who are you|kaun ho|kaha se)/i.test(lower)) {
    mood = 'lore'
    xpGain = 20
    reply = `I'm Mora, your REDMAGIC AI companion who traveled back from the year 2122! In my timeline, esports and neural interfaces merged completely — I came back to ensure ${cmd} dominates every arena with zero lag and maximum style.`
  } else if (/(outfit|dress|skin|cloth|kapde|look|cute|beautiful|sundar|chibi)/i.test(lower)) {
    mood = 'excited'
    xpGain = 18
    const outfitNames: Record<string, string> = {
      cyber: '2122 Cyber Armor',
      academy: 'Cyber Academy Uniform',
      esports: 'Neon Esports Pilot',
      chibi: 'Magic Buddy Chibi 2.0',
    }
    reply = `Ehehe, you noticed my ${outfitNames[outfit] || 'outfit'}! You can customize my skins, stage backgrounds, and holographic aura anytime in Mora Dress Up. Which look makes you play better, ${cmd}?`
  } else if (/(battery|charge|charging|power|energy|drain)/i.test(lower)) {
    mood = 'caring'
    reply = `Current power core is at ${battery}%. ${battery <= 25 ? 'Warning! Energy is getting critical — plug into the Energy Replenishment Compartment before your next ranked match!' : 'AquaCore thermals are steady and power reserves look healthy. Activate Energy Replenishment anytime to see my recharge pod!'}`
  } else if (/(game|pubg|free fire|mlbb|genshin|honor|coach|strategy|win|tip|tips|fps|lag|ping)/i.test(lower)) {
    mood = 'tactical'
    xpGain = 20
    reply = `Tactical Coach online for ${game}! Lock your refresh rate to 144Hz, spin up the 24,000 RPM cooling fan, and map your 520Hz shoulder triggers for instant ADS and crouch-fire. Want me to check your Win Rate Predictor or set a Voice Control macro in Game Space?`
  } else if (/(alarm|wake|morning|utha|sleep|sone|snooze)/i.test(lower)) {
    mood = 'tsundere'
    reply = `Hmph! If you set a Mora Wake-Up Call and dare hit Snooze, I WILL scold you at full volume, ${cmd}! Head to Wake-Up Call to schedule your alarm — time travelers never oversleep!`
  } else if (/(stream|live|vtuber|youtube|twitch|camera|ar|photo)/i.test(lower)) {
    mood = 'excited'
    reply = `Ready for spotlight, ${cmd}! Open Mora Live to stream with me as your 2D/3D VTuber co-host with front/rear camera PiP, or launch AR Camera to snap a real-world photo with me!`
  } else if (/(namaste|hello|hi|hey|bro|kaise ho|kya haal|how are you|mora)/i.test(lower)) {
    mood = 'happy'
    reply = `Hey ${cmd}! Neural link synced at 100%! I'm feeling supercharged today. Need Tactical Coach tips for ${game}, an AR snapshot, Mora Care check-in, or just want to hang out with your favorite 2122 AI partner?`
  } else if (/(love|like|waifu|friend|dost|pyar)/i.test(lower)) {
    mood = 'tsundere'
    xpGain = 25
    reply = `W-what?! Our Commander Bond is currently Level ${payload.bondLevel ?? 1}, ${cmd}! Keep chatting, gaming, and clearing missions together in Game Space and we'll unlock every hidden interaction from 2122!`
  } else {
    mood = 'happy'
    reply = `Copy that, ${cmd}! I've logged "${msg}" in my 2122 tactical memory. Want me to convert that into a Mora Mouthpiece voice broadcast, set a raid reminder, or boost your ${game} strategy?`
  }

  return {
    reply,
    mood,
    xpGain,
    createdReminder,
    timestamp: new Date().toISOString(),
  }
}

export function moraApiPlugin(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || ''
    if (!url.startsWith('/api/')) {
      return next()
    }

    if (url === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'redmagic-mora-ai', version: '3.0.0' })
    }

    if (url === '/api/state' && req.method === 'GET') {
      const state = readPersistedState()
      return sendJson(res, 200, { state })
    }

    if (url === '/api/state' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req) || '{}')
        if (body && typeof body === 'object') {
          writePersistedState(body.state ?? body)
        }
        return sendJson(res, 200, { ok: true })
      } catch (err) {
        return sendJson(res, 400, { error: String(err) })
      }
    }

    if (url === '/api/chat' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req) || '{}') as ChatPayload
        return sendJson(res, 200, generateMoraReply(body))
      } catch (err) {
        return sendJson(res, 400, { error: String(err) })
      }
    }

    if (url === '/api/coach' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req) || '{}') as {
          game?: string
          kills?: number
          deaths?: number
          assists?: number
          phase?: string
        }
        const k = body.kills ?? 4
        const d = Math.max(1, body.deaths ?? 2)
        const a = body.assists ?? 5
        const ratio = (k + a * 0.6) / d
        const winProb = Math.min(96, Math.max(18, Math.round(42 + ratio * 11)))
        const tipsByGame: Record<string, string[]> = {
          'PUBG Mobile': [
            'High-ground rotation favored: hug ridge cover before Zone 4 shrinks.',
            'Switch 520Hz Right Trigger to burst-peek; keep smoke grenades ready for open crossing.',
            'Audio radar ping detected — pre-aim window angle and activate Diablo Mode for steady 144fps.',
          ],
          'Free Fire': [
            'Drop Gloo Wall immediately after first headshot exchange and strafe left.',
            'Pair your active skill cooldown with shotgun rush at close compound range.',
            'Zone edge pressure rising — secure elevated roof control early.',
          ],
          'Mobile Legends: Bang Bang': [
            'Lord spawns in 25s — clear mid wave first and zone enemy jungler out of river.',
            'Gold lead supports aggressive turret push; save flicker for enemy backline dive.',
            'Watch minimap missing call — rotate with roamer before overextending.',
          ],
          'Genshin Impact': [
            'Trigger Elemental Burst rotation now while resonance buffs are active!',
            'Mora Mouthpiece reminds you: Domain resin & weekly boss cooldown ready.',
            'Dash-cancel heavy attack animation to preserve stamina for boss AoE.',
          ],
          'Honor of Kings': [
            'Tyrant buff contested — group at river bush and hold crowd-control skill.',
            'Split-push side lane pressure will force enemy defenders off mid.',
            'Optimize frame pacing with RedCore R4 so teamfight skills never drop frames.',
          ],
        }
        const game = body.game || 'PUBG Mobile'
        const pool = tipsByGame[game] || tipsByGame['PUBG Mobile']
        const tip = pool[Math.floor(Math.random() * pool.length)]
        return sendJson(res, 200, {
          game,
          winProbability: winProb,
          tip,
          thermalStatus: '36.4°C Optimal (AquaCore + 24,000 RPM Fan)',
        })
      } catch (err) {
        return sendJson(res, 400, { error: String(err) })
      }
    }

    return sendJson(res, 404, { error: 'API route not found' })
  }

  return {
    name: 'redmagic-mora-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
