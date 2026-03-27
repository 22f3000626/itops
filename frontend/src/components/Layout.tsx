import { NavLink, Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Bot, AlertTriangle, Server, Database, BookOpen,
} from 'lucide-react';

const NAV = [
  { to: '/',               icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents',         icon: Bot,             label: 'Agents' },
  { to: '/incidents',      icon: AlertTriangle,   label: 'Incidents' },
  { to: '/infrastructure', icon: Server,          label: 'Infrastructure' },
  { to: '/datasources',    icon: Database,         label: 'Data Sources' },
  { to: '/runbooks',       icon: BookOpen,        label: 'Runbooks' },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-bg-primary bg-grid flex flex-col">
      {/* ── Top navbar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 glass-sm !rounded-none border-x-0 border-t-0 px-6 py-0">
        <div className="max-w-[1600px] mx-auto flex items-center h-14 gap-8">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
              <Server size={18} className="text-accent" />
            </div>
            <span className="font-bold text-sm tracking-wide text-green-900">
              IT<span className="text-accent">Ops</span> Orchestrator
            </span>
          </div>

          <nav className="flex items-center gap-1 h-full">
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'text-accent bg-accent/10'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-black/5'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} />
                    <span>{label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="absolute bottom-0 left-3 right-3 h-0.5 bg-accent rounded-full"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent pulse-live" />
            <span className="text-xs text-green-700">System Live</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
