import { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, AlertTriangle, Server, Database, BookOpen, Cpu, Play, Settings,
  Menu, X,
} from 'lucide-react';
import GlassNavbar from './common/GlassNavbar';
import GlassTab from './common/GlassTab';
import PageTransition from './common/PageTransition';
import ParticleBackground from './ui/ParticleBackground';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/pipeline', icon: Play, label: 'Pipeline' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidents' },
  { to: '/infrastructure', icon: Server, label: 'Infrastructure' },
  { to: '/datasources', icon: Database, label: 'Data Sources' },
  { to: '/simulators', icon: Cpu, label: 'Simulators' },
  { to: '/runbooks', icon: BookOpen, label: 'Runbooks' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [condense, setCondense] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Drive the navbar shrink based on scroll within the main pane.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c = Math.min(1, main.scrollTop / 80);
        setCondense(c);
      });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Reset scroll on route change + close mobile drawer
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <ParticleBackground />

      <GlassNavbar condense={condense} className="liquid-glass">
        {/* Left Branding */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
          <div
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center gpu shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dim) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 16px -6px var(--color-accent-glow)',
            }}
          >
            <Server size={16} className="text-[var(--color-surface)]" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-display text-[17px] sm:text-[19px] text-[var(--color-ink)] leading-none">
              IT<span className="text-[var(--color-accent)] italic">ops</span>
            </span>
            <span
              className="hidden sm:inline label-eyebrow !text-[8.5px] mt-1 leading-none whitespace-nowrap"
              style={{ letterSpacing: '0.14em' }}
              title="Dynamic IT Operations Orchestrator"
            >
              Dynamic IT Operations Orchestrator
            </span>
          </div>
        </div>

        {/* Desktop nav tabs (visible lg+) */}
        <nav className="hidden lg:flex items-center gap-1 mx-auto">
          {NAV.map((item) => (
            <GlassTab
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
            />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="lg:hidden icon-btn"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </GlassNavbar>

      {/* ── Mobile slide-down menu ─────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="m-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden fixed inset-0 z-40 bg-[rgba(21,25,26,0.18)] backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              key="m-sheet"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="lg:hidden fixed top-[80px] inset-x-3 z-50 glass-mica p-3"
            >
              <nav className="flex flex-col gap-1">
                {NAV.map((item) => (
                  <GlassTab
                    key={item.to}
                    to={item.to}
                    icon={item.icon}
                    label={item.label}
                    layoutId="activeNavPillMobile"
                    onClick={() => setMobileOpen(false)}
                    fullWidth
                  />
                ))}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto pt-[80px] sm:pt-[100px] w-full"
      >
        <div className="max-w-[1600px] mx-auto w-full px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16">
          <AnimatePresence mode="wait">
            <PageTransition routeKey={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
