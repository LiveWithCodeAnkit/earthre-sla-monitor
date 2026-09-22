import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useTheme } from "../context/ThemeContext";

interface Props {
  children: ReactNode;
  /** Optional second row under the main nav (e.g. filters toolbar). */
  toolbar?: ReactNode;
  /** Compact status chip in the header (e.g. SLA compliant/breach). */
  status?: ReactNode;
}

/**
 * Shared persistent application chrome for Upload and Dashboard views.
 * Supports dynamic Day/Night (Light/Dark) theme switching with smooth transitions.
 */
export default function AppShell({ children, toolbar, status }: Props) {
  const { pathname } = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const isUpload = pathname === "/upload" || pathname === "/";
  const isDashboard = pathname.startsWith("/dashboard");

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#0b0f19] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* Persistent Global Header */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-[#0b0f19]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 shrink-0 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 sm:gap-4">
          {/* Logo & Branding */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/dashboard"
              className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-sm shrink-0 shadow-sm hover:bg-indigo-100 dark:hover:bg-indigo-500/25 transition-colors"
              title="EarthRe SLA Monitor"
            >
              ⚡
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  to="/dashboard"
                  className="font-bold text-sm text-slate-900 dark:text-white tracking-tight truncate hover:text-indigo-600 dark:hover:text-slate-200 transition-colors"
                >
                  SLA Monitor
                </Link>
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                  EarthRe
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight truncate">
                {isUpload ? "CSV Ingestion Pipeline" : "Production Service Health"}
              </p>
            </div>
          </div>

          {/* Right Header: Status Indicator, Theme Switcher & View Switcher */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 shrink-0">
            {status}

            {/* Segmented View Switcher */}
            <nav className="inline-flex items-center bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-0.5 sm:p-1 rounded-lg gap-1 shadow-inner transition-colors">
              <Link
                to="/upload"
                className={`text-xs font-semibold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all duration-150 ${
                  isUpload
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800/60"
                }`}
              >
                Upload CSV
              </Link>
              <Link
                to="/dashboard"
                className={`text-xs font-semibold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md transition-all duration-150 ${
                  isDashboard
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800/60"
                }`}
              >
                Dashboard
              </Link>
            </nav>

            {/* Day / Night Mode SVG Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/90 hover:bg-slate-200/80 dark:hover:bg-slate-800 text-slate-700 dark:text-amber-300 flex items-center justify-center transition-all duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              title={isDark ? "Switch to Day Mode (Light)" : "Switch to Night Mode (Dark)"}
              aria-label={isDark ? "Switch to Day Mode" : "Switch to Night Mode"}
            >
              {isDark ? (
                /* Sun SVG Icon for Night Mode */
                <svg
                  className="w-4 h-4 text-amber-300 hover:rotate-45 transition-transform duration-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                /* Moon SVG Icon for Day Mode */
                <svg
                  className="w-4 h-4 text-slate-700 hover:-rotate-12 transition-transform duration-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Optional Sub-Toolbar (e.g., Dashboard Date/Service Filters) */}
        {toolbar && (
          <div className="border-t border-slate-200/80 dark:border-slate-800/80 bg-slate-50/90 dark:bg-slate-900/40 backdrop-blur-sm transition-colors duration-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">{toolbar}</div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">{children}</div>

      {/* Global Footer */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 py-3.5 px-4 text-center text-xs text-slate-500 shrink-0 bg-white dark:bg-[#0b0f19] transition-colors duration-200">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>EarthRe Full Stack Developer Case Study</span>
          <span className="text-slate-400 dark:text-slate-600 font-mono text-[11px]">
            Cloudflare Workers · SQLite D1 · React SPA
          </span>
        </div>
      </footer>
    </div>
  );
}
