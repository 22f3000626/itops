import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  glow?: 'green' | 'red' | 'amber' | 'none';
  hover?: boolean;
  onClick?: () => void;
}

export default function GlassCard({ children, className = '', glow = 'none', hover = true, onClick }: Props) {
  const glowClass = glow === 'green' ? 'glow-green' : glow === 'red' ? 'glow-red' : glow === 'amber' ? 'glow-amber' : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      whileHover={hover ? { scale: 1.01, borderColor: 'rgba(34,197,94,0.35)' } : undefined}
      onClick={onClick}
      className={`glass p-5 ${glowClass} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </motion.div>
  );
}
