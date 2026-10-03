import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Cpu, Database, FileText, CheckCircle2, Loader2 } from 'lucide-react';

interface AgentStatusProps {
  statusMessage?: string;
  stage?: string;
}

const STAGE_ORDER = ['PROFILING', 'SYNTHESIZING', 'EXECUTING', 'HEALING', 'PERSISTING', 'COMPLETE'];

const STEPS = [
  { id: 'PROFILING', name: 'Understanding schema and context', hint: 'Reading columns, types and gaps', icon: Brain },
  { id: 'SYNTHESIZING', name: 'Writing the SQL plan', hint: 'Turning your question into queries', icon: Database },
  { id: 'EXECUTING', name: 'Running queries and self-healing', hint: 'Executing on DuckDB, retrying on errors', icon: Cpu },
  { id: 'PERSISTING', name: 'Writing the executive report', hint: 'Summarizing findings and saving the session', icon: FileText },
];

export const AgentStatus: React.FC<AgentStatusProps> = ({
  statusMessage = 'Engaging autonomous ReAct agents...',
  stage = 'PROFILING',
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Map backend stages to the UI steps (logic unchanged)
  const getStepStatus = (stepId: string) => {
    const currentIdx = STAGE_ORDER.indexOf(stage === 'HEALING' ? 'EXECUTING' : stage);
    const stepIdx = STAGE_ORDER.indexOf(stepId);

    if (currentIdx > stepIdx || stage === 'COMPLETE') return 'completed';
    if (currentIdx === stepIdx || (stepId === 'EXECUTING' && stage === 'HEALING')) return 'active';
    return 'pending';
  };

  const done = STEPS.filter((s) => getStepStatus(s.id) === 'completed').length;
  const progress = Math.round(((done + 0.5) / STEPS.length) * 100);
  const healing = stage === 'HEALING';
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="relative mx-auto max-w-xl">
      <div className={`absolute -inset-3 rounded-[2rem] blur-2xl transition-colors duration-700 ${healing ? 'bg-amber-500/15' : 'bg-gradient-to-r from-cyan-500/15 to-emerald-500/15'}`} />

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b111a]/90 p-7 shadow-2xl backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <span className={`absolute inset-0 animate-ping rounded-full opacity-30 ${healing ? 'bg-amber-400' : 'bg-cyan-400'}`} />
            <span className={`relative flex h-14 w-14 items-center justify-center rounded-full border ${healing ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'}`}>
              <Brain className="h-6 w-6" />
            </span>
          </div>
          <div className="min-w-0 flex-1 text-left">
            <h3 className="font-display text-xl font-bold text-white">Your analyst is working</h3>
            <p className="mt-0.5 text-sm text-slate-400">Agents are planning, querying and checking each other's work.</p>
          </div>
          <span className="text-sm text-slate-500" style={{ fontFamily: 'var(--font-mono)' }}>{mm}:{ss}</span>
        </div>

        {/* Progress */}
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <motion.div
            className={`h-full rounded-full ${healing ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-cyan-400 to-emerald-400'}`}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>

        {/* Live terminal */}
        <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/50">
          <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-red-400/60" />
            <span className="h-2 w-2 rounded-full bg-amber-400/60" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/60" />
            <span className="ml-2 text-[11px] text-slate-500" style={{ fontFamily: 'var(--font-mono)' }}>agent.log</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-3 text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
            <span className={healing ? 'text-amber-400' : 'text-emerald-400'}>{healing ? '!' : '>'}</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={statusMessage}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className={`truncate ${healing ? 'text-amber-300' : 'text-slate-300'}`}
              >
                {statusMessage}
              </motion.span>
            </AnimatePresence>
            <span className="inline-block h-3.5 w-1.5 shrink-0 animate-pulse bg-slate-400/70" />
          </div>
        </div>

        {/* Steps */}
        <ol className="mt-6 space-y-2.5 text-left">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const status = getStepStatus(step.id);
            const isHealing = healing && step.id === 'EXECUTING';

            return (
              <motion.li
                key={step.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors duration-300 ${
                  status === 'active'
                    ? isHealing ? 'border-amber-400/30 bg-amber-400/10' : 'border-cyan-400/30 bg-cyan-400/10'
                    : status === 'completed'
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-white/5 bg-white/[0.02] opacity-60'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  status === 'active'
                    ? isHealing ? 'bg-amber-400/20 text-amber-300' : 'bg-cyan-400/20 text-cyan-300'
                    : status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-500'
                }`}>
                  <Icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${status === 'pending' ? 'text-slate-500' : 'text-white'}`}>{step.name}</p>
                  <p className="truncate text-xs text-slate-500">{isHealing ? 'A query failed. The agent is fixing it and retrying.' : step.hint}</p>
                </div>

                {status === 'active' && <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${isHealing ? 'text-amber-300' : 'text-cyan-300'}`} />}
                {status === 'completed' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
              </motion.li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};