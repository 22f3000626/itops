import React from 'react';
import { motion } from 'framer-motion';
import { spring } from '../../lib/motion';

interface GlassNavbarProps {
  children: React.ReactNode;
  className?: string;
  /** 0 = at top, 1 = scrolled past threshold */
  condense?: number;
}

/**
 * Floating glass navbar pill.
 * `condense` (0..1) drives a subtle shrink + tighter blur as the page scrolls,
 * giving it the same "settling" feel as Safari's tab bar.
 */
const GlassNavbar: React.FC<GlassNavbarProps> = ({ children, className = '', condense = 0 }) => {
  const padTop = 20 - condense * 8;       // 20 → 12
  const height = 64 - condense * 8;       // 64 → 56
  const scale = 1 - condense * 0.012;     // 1 → 0.988
  const blur = 36 + condense * 12;        // 36 → 48

  return (
    <div
      className="fixed top-0 inset-x-0 z-50 px-3 sm:px-4 pb-2 w-full flex justify-center pointer-events-none"
      style={{ paddingTop: padTop }}
    >
      <motion.header
        initial={false}
        animate={{ height, scale }}
        transition={spring.smooth}
        style={{
          backdropFilter: `blur(${blur}px) saturate(180%)`,
          WebkitBackdropFilter: `blur(${blur}px) saturate(180%)`,
        }}
        className={`glass-navbar-pill w-full max-w-[1600px] flex items-center justify-between px-3 sm:px-5 pointer-events-auto gpu ${className}`}
      >
        {children}
      </motion.header>
    </div>
  );
};

export default GlassNavbar;
