import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import {
  Paperclip, X, MessageSquare, Plus, Download, Trash2, LogOut, Command, Zap,
  ChevronRight, FileText, User, ChevronDown, Sparkles, Menu, Database, Wand2,
  BarChart3, FileOutput, Bot, ShieldCheck, Workflow, LineChart, Table2
} from 'lucide-react';
import type { AnalysisResponse } from './types/dashboard';
import { AgentStatus } from './components/AgentStatus';
import { Dashboard } from './components/Dashboard';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';

const AgentStatusWithProps = AgentStatus as React.ComponentType<{ statusMessage: string; stage: string; }>;
const API = 'https://datamind-ai-api-gvix.onrender.com';

interface UserSession {
  id: string; name: string; email: string; avatar?: string;
  tier: 'FREE' | 'PRO'; tokenBalance: number;
}

/* ------------------------------------------------------------------ */
/*  DATA-FLOW BACKGROUND                                              */
/* ------------------------------------------------------------------ */
const DataFlowBackground = () => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const LINK = 150;
    let w = 0, h = 0, raf = 0, t = 0;
    const mouse = { x: -9999, y: -9999 };

    type N = { x: number; y: number; vx: number; vy: number; r: number };
    type P = { a: number; b: number; k: number; s: number };
    let nodes: N[] = [];
    let packets: P[] = [];

    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.floor(Math.min(80, (w * h) / 20000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.6 + 1,
      }));
      packets = [];
    };

    const spawnPacket = () => {
      const a = Math.floor(Math.random() * nodes.length);
      const near: number[] = [];
      nodes.forEach((n, i) => {
        if (i !== a && Math.hypot(n.x - nodes[a].x, n.y - nodes[a].y) < LINK) near.push(i);
      });
      if (!near.length) return;
      packets.push({ a, b: near[Math.floor(Math.random() * near.length)], k: 0, s: 0.008 + Math.random() * 0.012 });
    };

    const drawBars = () => {
      const bars = Math.ceil(w / 28);
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const wave = Math.sin(t * 0.6 + i * 0.35) * 0.5 + Math.sin(t * 0.23 + i * 0.12) * 0.5;
        const bh = 30 + (wave + 1) * 55 + Math.sin(i * 0.5) * 20;
        const g = ctx.createLinearGradient(0, h - bh, 0, h);
        g.addColorStop(0, 'rgba(34,211,238,0.16)');
        g.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = g;
        ctx.fillRect(i * bw + 3, h - bh, bw - 6, bh);
      }
    };

    const drawSparkline = () => {
      const base = h * 0.82;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = base - Math.sin(x * 0.008 + t * 0.8) * 26 - Math.sin(x * 0.021 - t * 0.5) * 12 - (x / w) * 40;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(52,211,153,0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    const frame = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      drawBars();
      drawSparkline();

      nodes.forEach((n) => {
        if (!reduce) {
          n.x += n.vx; n.y += n.vy;
          const dx = n.x - mouse.x, dy = n.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 120 && d > 0) { n.x += (dx / d) * 0.6; n.y += (dy / d) * 0.6; }
        }
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      });

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(148,163,184,${(1 - d / LINK) * 0.18})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
          }
        }
        const md = Math.hypot(nodes[i].x - mouse.x, nodes[i].y - mouse.y);
        if (md < 180) {
          ctx.strokeStyle = `rgba(34,211,238,${(1 - md / 180) * 0.5})`;
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }

      nodes.forEach((n) => {
        ctx.fillStyle = 'rgba(203,213,225,0.55)';
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      });

      if (!reduce) {
        if (packets.length < 14 && Math.random() < 0.08) spawnPacket();
        packets = packets.filter((p) => p.k < 1);
        packets.forEach((p) => {
          p.k += p.s;
          const a = nodes[p.a], b = nodes[p.b];
          if (!a || !b) { p.k = 1; return; }
          const x = a.x + (b.x - a.x) * p.k, y = a.y + (b.y - a.y) * p.k;
          ctx.shadowColor = 'rgba(52,211,153,0.9)'; ctx.shadowBlur = 10;
          ctx.fillStyle = '#34d399';
          ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        });
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };

    resize(); frame();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 bg-[#060a10]" />
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(14,165,233,0.16), transparent 70%), radial-gradient(ellipse 50% 40% at 85% 60%, rgba(16,185,129,0.10), transparent 70%)'
      }} />
      <canvas ref={ref} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#060a10]/70" />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  SMALL PIECES                                                      */
/* ------------------------------------------------------------------ */
const CountUp = ({ to, suffix = '' }: { to: number; suffix?: string }) => {
  const el = useRef<HTMLSpanElement>(null);
  const inView = useInView(el, { once: true });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let raf = 0; const start = performance.now(); const dur = 1400;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return <span ref={el}>{v.toLocaleString()}{suffix}</span>;
};

const MODELS = [
  'GPT-4o', 'Claude 3.5 Sonnet', 'Gemini 1.5 Pro', 'Llama 3.1 405B',
  'Command R+', 'Mistral Large 2', 'DuckDB', 'ReAct agents',
];

const ModelStrip = () => (
  <div className="relative overflow-hidden border-y border-white/5 bg-black/20 py-5 backdrop-blur-sm">
    <motion.div
      className="flex w-fit items-center gap-14 pr-14"
      animate={{ x: ['0%', '-50%'] }}
      transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
    >
      {[...MODELS, ...MODELS].map((m, i) => (
        <span key={i} className="flex items-center gap-2.5 whitespace-nowrap text-sm font-medium text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          {m}
        </span>
      ))}
    </motion.div>
    <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#060a10] to-transparent" />
    <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#060a10] to-transparent" />
  </div>
);

const ProductPreview = () => {
  const bars = [42, 68, 51, 84, 62, 95, 74, 58, 88, 70, 99, 80];
  return (
    <div className="relative mx-auto w-full max-w-5xl text-left">
      <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-emerald-500/20 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b111a]/90 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 truncate text-xs text-slate-500">sales_q3.csv: "Which regions are dragging revenue growth?"</span>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-3">
          {[['Revenue', '₹4.82 Cr', '+12.4%'], ['Orders', '38,210', '+6.1%'], ['Data quality', '98.7%', 'after cleaning']].map(([k, v, d]) => (
            <div key={k} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
              <p className="text-xs text-slate-500">{k}</p>
              <p className="mt-1 text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-mono)' }}>{v}</p>
              <p className="text-xs text-emerald-400">{d}</p>
            </div>
          ))}
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 md:col-span-2">
            <p className="mb-3 text-xs text-slate-500">Monthly revenue by region</p>
            <div className="flex h-36 items-end gap-2">
              {bars.map((b, i) => (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  whileInView={{ height: `${b}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, delay: i * 0.05 }}
                  className="flex-1 rounded-t bg-gradient-to-t from-cyan-500/30 to-cyan-300/80"
                />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
            <p className="mb-3 text-xs text-slate-500">Agent log</p>
            <ul className="space-y-2 text-xs text-slate-400" style={{ fontFamily: 'var(--font-mono)' }}>
              <li className="text-emerald-400">profiled 38,210 rows</li>
              <li>fixed 214 null values</li>
              <li>removed 31 duplicates</li>
              <li>ran 6 SQL queries</li>
              <li className="text-cyan-300">built 5 charts</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

const PIPELINE = [
  { icon: Database, title: 'Profile', text: 'Reads your file, detects types, gaps and outliers before touching anything.' },
  { icon: Wand2, title: 'Clean', text: 'Fixes nulls, duplicates and inconsistent formats, then shows you what changed.' },
  { icon: Bot, title: 'Analyze', text: 'ReAct agents plan, write queries, check results and retry when something looks off.' },
  { icon: BarChart3, title: 'Visualize', text: 'Picks the right chart for each finding and assembles the dashboard.' },
  { icon: FileOutput, title: 'Report', text: 'Writes a plain-language report you can export to Word and share.' },
];

const FEATURES = [
  { icon: Workflow, title: 'Autonomous agents', text: 'Describe the question once. Agents plan the steps, run them and verify the output.' },
  { icon: Table2, title: 'Automatic cleaning', text: 'Upload messy CSV, Excel, JSON or Parquet files and get a clean dataset back.' },
  { icon: LineChart, title: 'Live dashboards', text: 'Every analysis becomes an interactive dashboard, saved in your history.' },
  { icon: ShieldCheck, title: 'Your data stays yours', text: 'Sessions are private to your account, and you can delete any of them at any time.' },
];

const USE_CASES = [
  { who: 'Operations', text: 'Find where delays, backlogs and cost leaks start, straight from your exports.' },
  { who: 'Finance', text: 'Reconcile and summarize ledgers, variances and monthly trends in minutes.' },
  { who: 'Sales', text: 'See which regions, products and reps move revenue, and which ones do not.' },
  { who: 'Students and researchers', text: 'Clean survey data and get a first analysis before you open a notebook.' },
];

const STATS: Array<[number, string, string]> = [
  [5, '', 'agent stages per analysis'],
  [4, '', 'file formats supported'],
  [60, 's', 'typical time to first dashboard'],
  [100, '%', 'of sessions private to you'],
];

const fadeUp = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.5 } };

/* ------------------------------------------------------------------ */
/*  APP                                                               */
/* ------------------------------------------------------------------ */
export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<UserSession | null>(JSON.parse(localStorage.getItem('user') || 'null'));
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const [currentStage, setCurrentStage] = useState('PROFILING');
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState('Engaging autonomous ReAct agents...');

  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [wallet, setWallet] = useState<{ tier: 'FREE' | 'PRO'; balance: number }>({ tier: 'FREE', balance: 500 });
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; createdAt: string }>>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [cleanedFileUrl, setCleanedFileUrl] = useState<string | null>(null);

  const loggedIn = !!token && !!user;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* --- Auth --- */
  const finishAuth = (data: { token: string; user: UserSession }) => {
    setSessions([]); // 🛡️ Fix 1: Clear ghost sessions during fresh login
    localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token); setUser(data.user);
    setWallet({ tier: data.user.tier, balance: data.user.tokenBalance });
    setShowAuth(false); setAuthError(null);
  };

  const handleGoogleSuccess = async (cr: CredentialResponse) => {
    try {
      const res = await fetch(`${API}/api/auth/google`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: cr.credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      finishAuth(data);
    } catch { setAuthError('Google sign-in failed. Try again or use email.'); }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError(null);
    try {
      const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
      const payload = isLoginMode ? { email, password } : { email, password, name };
      
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      finishAuth(data);
    } catch (err: unknown) { 
      setAuthError((err as Error).message); 
    }
  };

  const resetWorkspace = () => {
    setCurrentSessionId(null); setAnalysis(null); setFile(null); setQuestion(''); setError(null); setCleanedFileUrl(null);
    if (textareaRef.current) textareaRef.current.style.height = '60px';
  };

  // 🛡️ Fix 2: The Nuclear Logout
  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/'; // Hard reload destroys all stale React memory closures
  };

  const openAuth = (login: boolean) => { setIsLoginMode(login); setAuthError(null); setShowAuth(true); };

  // 🛡️ Fix 3: Cache-Bust the Wallet Fetch
  const fetchWallet = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/wallet`, { 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        } 
      });
      if (res.ok) setWallet(await res.json());
    } catch (err: unknown) { console.error('Failed to fetch wallet:', err); }
  }, [token]);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setSessions(await res.json());
    } catch (err: unknown) { console.error('Failed to load history:', err); }
  }, [token]);

  const handleUpgrade = async () => {
    if (!token) return;
    if (!window.confirm('Simulate a ₹999 payment to upgrade to PRO?')) return;
    try {
      const res = await fetch(`${API}/api/payments/mock-upgrade`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWallet({ tier: data.tier, balance: data.balance });
    } catch { alert('Failed to process payment simulation.'); }
  };

  useEffect(() => {
    if (!token) return;
    const id = window.setTimeout(() => { void fetchWallet(); void loadHistory(); }, 0);
    return () => window.clearTimeout(id);
  }, [token, fetchWallet, loadHistory]);

  useEffect(() => {
    if (!currentSessionId || !token) return;
    const run = async () => {
      setLoading(true); setError(null); setCleanedFileUrl(null);
      try {
        const res = await fetch(`${API}/api/sessions/${currentSessionId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Failed to load session');
        const data = await res.json();
        setAnalysis({ ...data, exportLinks: [] });
      } catch (err: unknown) { setError((err as Error).message); setAnalysis(null); }
      finally { setLoading(false); }
    };
    void run();
  }, [currentSessionId, token]);

  useEffect(() => {
    if (loading || analysis) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, analysis]);

  /* --- File handling --- */
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
  };
  const autoResize = () => {
    const t = textareaRef.current;
    if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 200)}px`; }
  };

  const executeAction = async (endpoint: string, isCleanOnly: boolean) => {
    if (!file) return setError('Attach a dataset to continue.');
    if (!isCleanOnly && !question.trim()) return setError('Type what you want to analyze.');

    // 🛡️ Fix 4: Live Frontend File Validation using `wallet.tier` (Bypasses stale JWT claims)
    if (file.size > 5 * 1024 * 1024 && wallet.tier === 'FREE') {
      setError('File size exceeds 5MB limit for the Free tier. Toggle to PRO mode to process enterprise-scale datasets.');
      setFile(null); // Clear the file
      return;
    }

    setLoading(true); setError(null); setCleanedFileUrl(null); setAnalysis(null);
    setStatusMessage('Initializing background worker...');
    try {
      const formData = new FormData();
      formData.append('dataset', file);
      formData.append(isCleanOnly ? 'instructions' : 'question', question || 'Clean dataset');
      const res = await fetch(`${API}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (isCleanOnly) {
        setCleanedFileUrl(`${API}${data.downloadUrl}`); setLoading(false);
      } else {
        const es = new EventSource(`${API}/api/stream/${data.jobId}?token=${token}`);
        es.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.stage === 'ERROR') { setError(event.message); setLoading(false); es.close(); }
          else if (event.stage === 'COMPLETE') {
            setAnalysis(event.data);
            if (event.data?.sessionId) setCurrentSessionId(event.data.sessionId);
            void loadHistory(); void fetchWallet(); setLoading(false); es.close();
          } else { setStatusMessage(event.message); setCurrentStage(event.stage); }
        };
        es.onerror = () => { setError('Lost connection to worker.'); setLoading(false); es.close(); };
      }
    } catch (err: unknown) { setError((err as Error).message); setLoading(false); }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API}/api/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to delete.');
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (currentSessionId === id) resetWorkspace();
    } catch { alert('Failed to delete session.'); }
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40';
  const pill = 'rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300';

  return (
    <div className="relative min-h-screen text-slate-200 selection:bg-cyan-400/30" style={{ fontFamily: 'var(--font-body)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        :root { --font-display: 'Bricolage Grotesque', 'IBM Plex Sans', system-ui, sans-serif; --font-body: 'IBM Plex Sans', system-ui, sans-serif; --font-mono: 'IBM Plex Mono', ui-monospace, monospace; }
        html { scroll-behavior: smooth; }
        .font-display { font-family: var(--font-display); letter-spacing: -0.02em; }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
      `}</style>

      <DataFlowBackground />

      {/* ---------------- HEADER ---------------- */}
      <header className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${scrolled ? 'border-b border-white/5 bg-[#060a10]/80 backdrop-blur-xl' : 'bg-transparent'}`}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-8">
            {loggedIn && (
              <button onClick={() => setShowHistory(true)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Open history">
                <Menu className="h-5 w-5" />
              </button>
            )}
            <a href="#top" className="flex items-center gap-2 text-white">
              <Command className="h-5 w-5 text-cyan-300" />
              <span className="font-display text-lg font-bold">DataMind<span className="font-medium text-slate-500">.ai</span></span>
            </a>
            <nav className="hidden items-center gap-7 text-sm text-slate-400 md:flex">
              <a href="#platform" className="transition hover:text-white">Platform</a>
              <a href="#how" className="transition hover:text-white">How it works</a>
              <a href="#use-cases" className="transition hover:text-white">Use cases</a>
            </nav>
          </div>

          {loggedIn && user ? (
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{wallet.balance.toLocaleString()}</span> credits
              </span>
              <div className="relative">
                <button onClick={() => setShowAccountMenu(!showAccountMenu)} className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
                  <User className="h-4 w-4" /> Account <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showAccountMenu && <div className="fixed inset-0 z-40" onClick={() => setShowAccountMenu(false)} />}
                <AnimatePresence>
                  {showAccountMenu && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                      className="absolute right-0 top-9 z-50 w-60 rounded-2xl border border-white/10 bg-[#0b111a]/95 p-2 shadow-2xl backdrop-blur-xl">
                      <div className="mb-2 flex items-center gap-3 border-b border-white/5 px-3 py-3">
                        {user.avatar
                          ? <img src={user.avatar} className="h-8 w-8 rounded-full" alt="" />
                          : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">{user.name?.charAt(0)}</div>}
                        <div className="overflow-hidden">
                          <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                          <p className="truncate text-xs text-slate-400">{user.email}</p>
                        </div>
                      </div>
                      <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white">API keys</button>
                      <button onClick={handleLogout} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-red-400/10">
                        <LogOut className="h-3.5 w-3.5" /> Sign out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {wallet.tier === 'FREE'
                ? <button onClick={handleUpgrade} className={`${pill} flex items-center gap-1.5`}>Upgrade <Sparkles className="h-3.5 w-3.5" /></button>
                : <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300">Pro</span>}
            </div>
          ) : (
            <div className="flex items-center gap-5">
              <button onClick={() => openAuth(true)} className="text-sm text-slate-300 hover:text-white">Sign in</button>
              <button onClick={() => openAuth(false)} className={`${pill} flex items-center gap-1.5`}>Get started <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      </header>

      <main id="top" className="relative z-10">
        {/* ---------------- HERO ---------------- */}
        <section className="mx-auto flex max-w-7xl flex-col items-center px-5 pb-20 pt-36 text-center md:pt-44">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Agentic AI for data analysis
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="font-display max-w-4xl text-5xl font-bold leading-[1.05] text-white md:text-7xl">
            Ask a question about your data. Agents do the analysis.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="mt-6 max-w-2xl text-lg text-slate-400">
            Upload a spreadsheet. DataMind cleans it, runs the queries, builds the dashboard and writes the report, so you get answers instead of homework.
          </motion.p>

          {!loggedIn && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-9 flex flex-wrap justify-center gap-3">
              <button onClick={() => openAuth(false)} className={`${pill} px-7 py-3 text-base`}>Start analyzing free</button>
              <a href="#how" className="rounded-full border border-white/15 px-7 py-3 text-base font-medium text-white transition hover:bg-white/5">See how it works</a>
            </motion.div>
          )}

          {loggedIn ? (
            <div className="mt-12 w-full max-w-3xl text-left">
              <div
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                className={`relative rounded-3xl border bg-[#0b111a]/80 p-3 shadow-2xl backdrop-blur-2xl transition ${dragActive ? 'border-cyan-400/60 bg-cyan-950/30' : 'border-white/10 focus-within:border-white/25'}`}
              >
                {dragActive && <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-cyan-400 bg-[#060a10]/90 text-sm font-medium text-cyan-300">Drop your dataset here</div>}
                {file && (
                  <div className="mb-2 flex w-fit max-w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400"><FileText className="h-4 w-4" /></span>
                    <span className="truncate text-sm text-slate-200">{file.name}</span>
                    <button onClick={() => setFile(null)} className="ml-1 shrink-0 rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-white" aria-label="Remove file"><X className="h-4 w-4" /></button>
                  </div>
                )}
                <textarea
                  ref={textareaRef} value={question}
                  onChange={(e) => { setQuestion(e.target.value); autoResize(); }}
                  placeholder="Attach a dataset, then ask: “Which products lost margin last quarter?”"
                  className="max-h-[250px] min-h-[60px] w-full resize-none bg-transparent px-3 py-2 text-base text-white placeholder-slate-500 outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:border-white/10 hover:bg-white/5 hover:text-white">
                    <Paperclip className="h-4 w-4" /> {file ? 'Change file' : 'Attach data'}
                  </button>
                  <input type="file" accept=".csv,.xlsx,.json,.parquet" className="hidden" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => executeAction('/api/clean', true)} disabled={!file || loading} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40">Clean only</button>
                    <button onClick={() => executeAction('/api/analyze', false)} disabled={!file || !question.trim() || loading}
                      className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:bg-slate-800 disabled:text-slate-500">
                      Generate dashboard <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-300" role="alert">{error}</motion.div>
                )}
                {cleanedFileUrl && (
                  <motion.a initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} href={cleanedFileUrl} download
                    className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-sm transition hover:bg-emerald-500/20">
                    <span className="text-emerald-300">Your dataset is clean.</span>
                    <span className="flex items-center gap-1.5 font-semibold text-emerald-300"><Download className="h-4 w-4" /> Download file</span>
                  </motion.a>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="mt-16 w-full"><ProductPreview /></div>
          )}
        </section>

        {/* ---------------- RESULTS (flow with the page, no fixed pane) ---------------- */}
        {loggedIn && (
          <section id="workspace" ref={resultsRef} className={`mx-auto max-w-7xl scroll-mt-20 px-5 ${loading || analysis ? 'pb-24' : ''}`}>
            {loading && <div className="mx-auto max-w-2xl py-16"><AgentStatusWithProps statusMessage={statusMessage} stage={currentStage} /></div>}
            {!loading && analysis && (
              <div>
                <div className="mb-4 flex justify-end">
                  {currentSessionId && analysis.detailedReport && (
                    <a href={`${API}/api/sessions/${currentSessionId}/export/word?token=${token}`}
                      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
                      <Download className="h-4 w-4" /> Export report
                    </a>
                  )}
                </div>
                <Dashboard data={analysis as Parameters<typeof Dashboard>[0]['data']} onReset={resetWorkspace} />
              </div>
            )}
          </section>
        )}

        <ModelStrip />

        {/* ---------------- STATS ---------------- */}
        <section className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-5 py-20 text-center md:grid-cols-4">
          {STATS.map(([n, s, label]) => (
            <motion.div key={label} {...fadeUp}>
              <p className="font-display text-5xl font-bold text-white"><CountUp to={n} suffix={s} /></p>
              <p className="mt-2 text-sm text-slate-400">{label}</p>
            </motion.div>
          ))}
        </section>

        {/* ---------------- PLATFORM ---------------- */}
        <section id="platform" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20">
          <motion.div {...fadeUp} className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-4xl font-bold text-white md:text-5xl">One platform from raw file to finished report</h2>
            <p className="mt-4 text-slate-400">Skip the cleanup scripts and chart tweaking. Describe what you need and review what the agents built.</p>
          </motion.div>
          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <motion.div key={title} {...fadeUp} className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur-md transition hover:border-cyan-400/30 hover:bg-white/[0.05]">
                <Icon className="h-6 w-6 text-cyan-300" />
                <h3 className="font-display mt-5 text-xl font-bold text-white">{title}</h3>
                <p className="mt-2 max-w-md text-slate-400">{text}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ---------------- HOW IT WORKS (a real sequence, so numbered) ---------------- */}
        <section id="how" className="mx-auto max-w-5xl scroll-mt-20 px-5 py-20">
          <motion.h2 {...fadeUp} className="font-display mb-14 text-center text-4xl font-bold text-white md:text-5xl">What happens after you press Generate</motion.h2>
          <ol className="relative space-y-6 border-l border-white/10 pl-8">
            {PIPELINE.map(({ icon: Icon, title, text }, i) => (
              <motion.li key={title} {...fadeUp} className="relative">
                <span className="absolute -left-[3.05rem] flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/40 bg-[#0b111a] text-sm text-cyan-300" style={{ fontFamily: 'var(--font-mono)' }}>{i + 1}</span>
                <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <div>
                    <h3 className="font-display text-lg font-bold text-white">{title}</h3>
                    <p className="mt-1 text-slate-400">{text}</p>
                  </div>
                </div>
              </motion.li>
            ))}
          </ol>
        </section>

        {/* ---------------- USE CASES ---------------- */}
        <section id="use-cases" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20">
          <motion.h2 {...fadeUp} className="font-display mb-12 text-center text-4xl font-bold text-white md:text-5xl">Built for people who live in spreadsheets</motion.h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map(({ who, text }) => (
              <motion.div key={who} {...fadeUp} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-6">
                <h3 className="font-display text-lg font-bold text-white">{who}</h3>
                <p className="mt-2 text-sm text-slate-400">{text}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ---------------- CTA ---------------- */}
        <section className="mx-auto max-w-5xl px-5 py-24">
          <motion.div {...fadeUp} className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/15 via-[#0b111a] to-emerald-500/15 p-10 text-center md:p-16">
            <h2 className="font-display text-3xl font-bold text-white md:text-5xl">Bring your messiest file</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">Your first 500 compute credits are free. No card needed.</p>
            <button onClick={() => (loggedIn ? scrollToTop() : openAuth(false))} className={`${pill} mt-8 px-8 py-3 text-base`}>
              {loggedIn ? 'Upload a dataset' : 'Create free account'}
            </button>
          </motion.div>
        </section>

        {/* ---------------- FOOTER ---------------- */}
        <footer className="border-t border-white/5 bg-black/30 px-5 py-10 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-sm text-slate-500 md:flex-row">
            <span className="flex items-center gap-2 text-slate-300"><Command className="h-4 w-4 text-cyan-300" /> DataMind.ai</span>
            <div className="flex gap-6"><a href="#platform" className="hover:text-white">Platform</a><a href="#how" className="hover:text-white">How it works</a><a href="#use-cases" className="hover:text-white">Use cases</a></div>
            <span>© {new Date().getFullYear()} DataMind.ai</span>
          </div>
        </footer>
      </main>

      {/* ---------------- HISTORY DRAWER ---------------- */}
      <AnimatePresence>
        {showHistory && loggedIn && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
            <motion.aside initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }} transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 flex w-80 flex-col justify-between border-r border-white/10 bg-[#0b111a]/95 backdrop-blur-xl">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between p-4">
                  <span className="px-2 text-sm font-semibold text-slate-300">Recent analyses</span>
                  <div className="flex gap-1">
                    <button onClick={() => { resetWorkspace(); setShowHistory(false); scrollToTop(); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" title="New analysis" aria-label="New analysis"><Plus className="h-4 w-4" /></button>
                    <button onClick={() => setShowHistory(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
                  {sessions.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No analyses yet. Attach a dataset and ask your first question.</p>}
                  {sessions.map((s) => (
                    <div key={s.id} onClick={() => { setCurrentSessionId(s.id); setShowHistory(false); }}
                      className={`group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${currentSessionId === s.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
                      <span className="flex items-center gap-3 truncate pr-2"><MessageSquare className="h-4 w-4 shrink-0 opacity-60" /><span className="truncate">{s.title}</span></span>
                      <button onClick={(e) => handleDeleteSession(e, s.id)} className="p-1 opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100" aria-label="Delete analysis"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-white/10 p-5">
                <div className="mb-2.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-slate-400"><Zap className="h-3.5 w-3.5 text-amber-400" /> Compute credits</span>
                  <span className="text-slate-200" style={{ fontFamily: 'var(--font-mono)' }}>{wallet.balance.toLocaleString()} <span className="text-slate-600">/ {wallet.tier === 'FREE' ? 500 : '10K'}</span></span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-900">
                  <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500" style={{ width: `${Math.min(100, (wallet.balance / (wallet.tier === 'FREE' ? 500 : 10000)) * 100)}%` }} />
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- AUTH MODAL ---------------- */}
      <AnimatePresence>
        {showAuth && !loggedIn && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm" onClick={() => setShowAuth(false)}>
            <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              className="relative w-full max-w-[420px] rounded-3xl border border-white/10 bg-[#0b111a]/95 p-7 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <button onClick={() => setShowAuth(false)} className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
              <h2 className="font-display text-2xl font-bold text-white">{isLoginMode ? 'Welcome back' : 'Create your account'}</h2>
              <p className="mb-6 mt-1 text-sm text-slate-400">{isLoginMode ? 'Sign in to open your workspace.' : 'Free to start. 500 compute credits included.'}</p>
              <form onSubmit={handleEmailAuth} className="mb-5 space-y-3">
                {!isLoginMode && <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} />}
                <input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
                <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
                {authError && <p className="text-center text-xs text-red-400" role="alert">{authError}</p>}
                <button type="submit" className="w-full rounded-xl bg-white py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200">{isLoginMode ? 'Sign in' : 'Create account'}</button>
              </form>
              <div className="relative mb-5 flex items-center"><div className="flex-grow border-t border-white/10" /><span className="mx-4 text-xs text-slate-500">or</span><div className="flex-grow border-t border-white/10" /></div>
              <div className="flex justify-center"><GoogleLogin onSuccess={handleGoogleSuccess} onError={() => setAuthError('Google sign-in failed. Try again or use email.')} theme="filled_black" shape="pill" /></div>
              <p className="mt-6 text-center text-sm text-slate-500">
                {isLoginMode ? 'New here?' : 'Already have an account?'}{' '}
                <button type="button" onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(null); }} className="font-medium text-white hover:underline">{isLoginMode ? 'Create an account' : 'Sign in'}</button>
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}