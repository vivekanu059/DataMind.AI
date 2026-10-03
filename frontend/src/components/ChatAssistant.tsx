import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  fileLocation: string;
  sessionId: string;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = [
  'Summarize the three most important findings',
  'Which rows look like outliers?',
  'What should I do next based on this data?',
];

const PROSE =
  'prose prose-invert max-w-none text-sm leading-relaxed prose-headings:font-bold prose-headings:text-white prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-strong:text-white prose-table:my-3 prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-white/10 prose-th:bg-white/10 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-white prose-td:border prose-td:border-white/10 prose-td:px-3 prose-td:py-2';

export const ChatAssistant: React.FC<Props> = ({ fileLocation, sessionId }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'I am your dedicated Data Analyst for this report. Ask me anything about specific rows, edge cases, or request deeper breakdowns!' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view without moving the whole page
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    // 🛡️ Grab the active token from localStorage
    const token = localStorage.getItem('token');

    try {
      const res = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // 🛡️ Attach token to bypass the 401 Unauthorized error
        },
        body: JSON.stringify({
          userQuery: userMsg,
          fileLocation,
          sessionId,
          chatHistory: messages.map((m) => ({ role: m.role, message: m.text })),
        }),
      });

      // 🛡️ Gracefully handle 401 Unauthorized if the token is missing/expired
      if (res.status === 401) {
        setMessages((prev) => [...prev, { role: 'assistant', text: `⚠️ **Unauthorized:** Your session has expired or you are not logged in. Please log in again to continue.` }]);
        return;
      }

      const data = await res.json();

      if (res.status === 429) {
        setMessages((prev) => [...prev, { role: 'assistant', text: `⚠️ **Token limit reached**\n\n${data.message}` }]);
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, I could not inspect the dataset just now. Check your connection and try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const showSuggestions = messages.length === 1 && !loading;

  return (
    <section className="relative">
      <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-r from-cyan-500/10 via-transparent to-emerald-500/10 blur-2xl" />
      <div className="relative flex h-[620px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b111a]/90 shadow-2xl backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h3 className="font-display text-base font-bold text-white">Analyst co-pilot</h3>
              <p className="text-xs text-slate-500">Ask follow-ups. Answers come from live queries on your dataset.</p>
            </div>
          </div>
          <span className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            Connected to dataset
          </span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                  <Bot className="h-4 w-4" />
                </span>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'rounded-tr-md bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-900/30'
                    : 'overflow-x-auto rounded-tl-md border border-white/10 bg-white/[0.04] text-slate-200'
                }`}
              >
                {m.role === 'user' ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                ) : (
                  <div className={PROSE}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  </div>
                )}
              </div>

              {m.role === 'user' && (
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300">
                  <User className="h-4 w-4" />
                </span>
              )}
            </motion.div>
          ))}

          {showSuggestions && (
            <div className="flex flex-wrap gap-2 pl-11">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                <Bot className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2].map((d) => (
                    <motion.span
                      key={d}
                      className="h-1.5 w-1.5 rounded-full bg-cyan-300"
                      animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
                      transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }}
                    />
                  ))}
                </span>
                <span className="text-xs text-slate-400" style={{ fontFamily: 'var(--font-mono)' }}>running live SQL on your dataset</span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-white/5 p-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a follow-up question..."
            aria-label="Ask a follow-up question"
            className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-950 transition hover:bg-slate-200 disabled:bg-slate-800 disabled:text-slate-500"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </section>
  );
};