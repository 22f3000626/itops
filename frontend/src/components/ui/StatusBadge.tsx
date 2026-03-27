import { motion } from 'framer-motion';

const COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  healthy:  { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  degraded: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  critical: { bg: 'bg-red-500/10',   text: 'text-red-400',   dot: 'bg-red-400' },
  offline:  { bg: 'bg-gray-500/10',  text: 'text-gray-400',  dot: 'bg-gray-400' },

  low:      { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  medium:   { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  high:     { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },

  detected:          { bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  analyzing:         { bg: 'bg-cyan-500/10',   text: 'text-cyan-400',   dot: 'bg-cyan-400' },
  diagnosed:         { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  awaiting_approval: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  remediating:       { bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  resolved:          { bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
  escalated:         { bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400' },
  failed:            { bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400' },

  active:     { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  connected:  { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  configured: { bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400' },
  error:      { bg: 'bg-red-500/10',   text: 'text-red-400',   dot: 'bg-red-400' },
};

export default function StatusBadge({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const c = COLORS[status] || COLORS.detected;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <motion.span
        className={`w-1.5 h-1.5 rounded-full ${c.dot} ${pulse ? 'pulse-live' : ''}`}
        animate={pulse ? { scale: [1, 1.3, 1] } : undefined}
        transition={pulse ? { duration: 2, repeat: Infinity } : undefined}
      />
      {status.replace(/_/g, ' ')}
    </span>
  );
}
