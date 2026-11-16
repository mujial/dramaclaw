import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface CyberModalProps {
  open: boolean
  title: string
  subtitle?: string
  icon?: React.ReactNode
  onClose: () => void
  maxWidth?: string
  children: React.ReactNode
}

export const CyberModal: React.FC<CyberModalProps> = ({
  open,
  title,
  subtitle,
  icon,
  onClose,
  maxWidth = 'max-w-4xl',
  children,
}) => {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 18 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className={`relative w-full ${maxWidth} max-h-[88vh] flex flex-col rm-glass rounded-2xl border border-rose-500/40 overflow-hidden shadow-[0_0_50px_rgba(255,42,75,0.22)]`}
          >
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-white/10 bg-gradient-to-r from-rose-600/20 via-slate-900/80 to-cyan-500/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {icon && (
                  <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-400/50 flex items-center justify-center text-rose-300">
                    {icon}
                  </div>
                )}
                <div>
                  <h2 className="font-cyber text-sm sm:text-base font-bold tracking-wider text-white uppercase">
                    {title}
                  </h2>
                  {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/25 border border-white/10 text-slate-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
