import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Mic, MicOff, Send, Sparkles, X } from 'lucide-react'
import type { ChatMessage } from '../types/mora'
import { startVoiceRecognition } from '../utils/speech'

interface MoraChatDrawerProps {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  onSend: (text: string) => Promise<void>
  commanderName: string
}

const QUICK_PROMPTS = [
  'Tell me your 2122 backstory!',
  'Give me PUBG Mobile tactical tips',
  'Remind me about Boss Raid in 15s',
  'How is our battery & thermal status?',
  'Check my outfit & Bond Level',
]

export const MoraChatDrawer: React.FC<MoraChatDrawerProps> = ({
  open,
  onClose,
  messages,
  onSend,
  commanderName,
}) => {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const stopMicRef = useRef<(() => void) | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setInput('')
    setSending(true)
    try {
      await onSend(trimmed)
    } finally {
      setSending(false)
    }
  }

  const toggleMic = () => {
    if (listening) {
      stopMicRef.current?.()
      setListening(false)
      return
    }
    setListening(true)
    const stop = startVoiceRecognition(
      (transcript) => {
        setListening(false)
        submit(transcript)
      },
      () => {
        setListening(false)
      },
    )
    if (!stop) {
      setListening(false)
    } else {
      stopMicRef.current = stop
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 360 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 360 }}
          transition={{ type: 'spring', damping: 24, stiffness: 240 }}
          className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[400px] rm-glass border-l border-rose-500/40 flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-rose-600/20 to-cyan-600/10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-400/50 flex items-center justify-center text-rose-300">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-cyber text-sm font-bold tracking-wider text-white">
                  MORA AI CHAT
                </h3>
                <p className="text-[11px] text-cyan-300">
                  2122 Neural Link · Synced with {commanderName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Chips */}
          <div className="px-3 py-2 border-b border-white/10 flex gap-1.5 overflow-x-auto">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-white/5 hover:bg-rose-500/25 border border-white/15 hover:border-rose-400/50 text-slate-200 transition-colors flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-rose-400" />
                {q}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-gradient-to-br from-rose-600 to-rose-700 text-white rounded-br-sm shadow-md'
                      : 'bg-slate-800/90 border border-cyan-500/30 text-slate-100 rounded-bl-sm'
                  }`}
                >
                  {m.sender === 'mora' && (
                    <div className="text-[10px] font-cyber uppercase tracking-widest text-rose-400 mb-1">
                      MORA · {m.mood || 'online'}
                    </div>
                  )}
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit(input)
            }}
            className="p-3 border-t border-white/10 bg-[#070a12]/90 flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleMic}
              title="Speak to Mora"
              className={`p-2.5 rounded-xl border transition-all ${
                listening
                  ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                  : 'bg-white/5 border-white/15 text-slate-300 hover:text-white'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Mora anything (EN / Hinglish)..."
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="p-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:opacity-40 text-white transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
