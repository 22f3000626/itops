import { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, AlertTriangle, Server, Database, BookOpen, Cpu, Play, Settings,
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

  // Reset scroll on route change
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <ParticleBackground />

      <GlassNavbar condense={condense} className="liquid-glass">
        {/* Left Branding */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center gpu"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dim) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 16px -6px var(--color-accent-glow)',
            }}
          >
            <Server size={17} className="text-[var(--color-surface)]" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-[19px] text-[var(--color-ink)] leading-none">
              IT<span className="text-[var(--color-accent)] italic">ops</span>
            </span>
            <span
              className="label-eyebrow !text-[8.5px] mt-1 leading-none whitespace-nowrap"
              style={{ letterSpacing: '0.14em' }}
              title="Dynamic IT Operations Orchestrator"
            >
              Dynamic IT Operations Orchestrator
            </span>
          </div>
        </div>

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

        <div className="ml-auto flex items-center gap-3 shrink-0" />
      </GlassNavbar>

      <main ref={mainRef} className="flex-1 overflow-y-auto pt-[100px] w-full">
        <div className="max-w-[1600px] mx-auto w-full px-8 pb-16">
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
