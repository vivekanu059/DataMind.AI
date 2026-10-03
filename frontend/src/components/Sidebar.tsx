import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';

interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
}

interface Props {
  onNewSession: () => void;
  onLoadSession: (sessionId: string) => void;
  /** Highlights the session that is currently open (optional). */
  activeSessionId?: string | null;
  /** Called after a session is deleted, so App can clear the workspace if it was the open one (optional). */
  onSessionDeleted?: (sessionId: string) => void;
}

const API = 'https://datamind-ai-api-gvix.onrender.com';

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;
type Group = (typeof GROUP_ORDER)[number];

const groupOf = (iso: string): Group => {
  const d = new Date(iso);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - d.getTime()) / 86_400_000);
  if (d >= startOfToday) return 'Today';
  if (days < 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  return 'Older';
};

export const Sidebar: React.FC<Props> = ({ onNewSession, onLoadSession, activeSessionId, onSessionDeleted }) => {
  const [history, setHistory] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const authHeaders = useCallback((): HeadersInit => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API}/api/sessions`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Request failed');
        setHistory(await res.json());
      } catch (error) {
        console.error('Failed to load history:', error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    void fetchHistory();
  }, [authHeaders]);

  const handleDeleteSession = async (id: string) => {
    setDeleteError(null);
    try {
      const res = await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to delete session.');
      setHistory((prev) => prev.filter((s) => s.id !== id));
      setConfirmingId(null);
      onSessionDeleted?.(id);
    } catch (err) {
      console.error('Delete error:', err);
      setDeleteError('Could not delete that analysis. Try again.');
    }
  };

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = history.filter((s) => !q || s.title.toLowerCase().includes(q));
    return GROUP_ORDER
      .map((g) => ({ label: g, items: filtered.filter((s) => groupOf(s.createdAt) === g) }))
      .filter((g) => g.items.length > 0);
  }, [history, query]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-white/10 bg-[#0b111a]/90 backdrop-blur-xl">
      {/* New analysis */}
      <div className="p-4 pb-3">
        <button
          onClick={onNewSession}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <Plus className="h-4 w-4" /> New analysis
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search analyses"
            aria-label="Search analyses"
            className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
          />
        </label>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {loading && (
          <div className="space-y-2 px-1 pt-2" aria-label="Loading analyses">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-white/5" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        )}

        {!loading && loadError && (
          <p className="mx-1 mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs text-red-300" role="alert">
            Could not load your analyses. Check that the server is running, then refresh.
          </p>
        )}

        {!loading && !loadError && history.length === 0 && (
          <div className="mx-1 mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
            <MessageSquare className="mx-auto h-5 w-5 text-slate-600" />
            <p className="mt-3 text-sm font-medium text-slate-300">No analyses yet</p>
            <p className="mt-1 text-xs text-slate-500">Attach a dataset and ask your first question to see it here.</p>
          </div>
        )}

        {!loading && !loadError && history.length > 0 && grouped.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-500">No analyses match “{query}”.</p>
        )}

        {deleteError && (
          <p className="mx-1 mb-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">{deleteError}</p>
        )}

        {grouped.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1.5 px-3 text-xs font-medium text-slate-500">{group.label}</p>
            <ul className="space-y-0.5">
              <AnimatePresence initial={false}>
                {group.items.map((session) => {
                  const active = activeSessionId === session.id;
                  const confirming = confirmingId === session.id;
                  return (
                    <motion.li
                      key={session.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onLoadSession(session.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLoadSession(session.id); } }}
                        className={`group relative flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${
                          active ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-cyan-300" />}

                        <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
                          <MessageSquare className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-cyan-300' : 'text-slate-500 group-hover:text-cyan-300'}`} />
                          <div className="min-w-0">
                            <p className={`truncate text-sm ${active ? 'font-medium text-white' : 'text-slate-300'}`}>{session.title}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500" style={{ fontFamily: 'var(--font-mono)' }}>
                              {new Date(session.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                        </div>

                        {confirming ? (
                          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <span className="mr-1 text-[11px] text-slate-400">Delete?</span>
                            <button
                              onClick={() => void handleDeleteSession(session.id)}
                              className="rounded-md p-1.5 text-red-300 transition hover:bg-red-400/20"
                              aria-label="Confirm delete"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmingId(null)}
                              className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                              aria-label="Cancel delete"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteError(null); setConfirmingId(session.id); }}
                            className="shrink-0 rounded-md p-1.5 text-slate-500 opacity-0 transition hover:bg-red-400/15 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                            aria-label={`Delete ${session.title}`}
                            title="Delete analysis"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
};