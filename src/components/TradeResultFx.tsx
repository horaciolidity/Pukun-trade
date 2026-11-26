import { useEffect, useState } from 'react';
import { Sparkles, TrendingDown } from 'lucide-react';

export interface TradeFxPayload {
  id: number;
  amount: number;
  label?: string;
}

export function triggerTradeResultFx(amount: number, label?: string) {
  if (typeof window === 'undefined' || !Number.isFinite(amount) || amount === 0) return;
  window.dispatchEvent(
    new CustomEvent('pukun:trade-fx', {
      detail: { id: Date.now() + Math.random(), amount, label },
    })
  );
}

const SPARKS = Array.from({ length: 24 }, (_, idx) => {
  const angle = (idx / 24) * Math.PI * 2;
  const dist = 110 + (idx % 4) * 38;
  return {
    id: idx,
    tx: `${Math.round(Math.cos(angle) * dist)}px`,
    ty: `${Math.round(Math.sin(angle) * dist)}px`,
    color: idx % 3 === 0 ? '#f59e0b' : idx % 3 === 1 ? '#10b981' : '#22d3ee',
    size: idx % 2 === 0 ? 10 : 7,
    delay: `${(idx % 5) * 35}ms`,
  };
});

const DRIPS = Array.from({ length: 14 }, (_, idx) => ({
  id: idx,
  leftPct: 12 + idx * 5.8,
  height: 18 + (idx % 4) * 10,
  dist: `${75 + (idx % 5) * 28}px`,
  delay: `${idx * 65}ms`,
}));

export function TradeResultFx() {
  const [activeFx, setActiveFx] = useState<TradeFxPayload | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<TradeFxPayload>).detail;
      if (!detail || typeof detail.amount !== 'number' || detail.amount === 0) return;
      setActiveFx(detail);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        setActiveFx(null);
      }, 2450);
    };

    window.addEventListener('pukun:trade-fx', handler);
    return () => {
      window.removeEventListener('pukun:trade-fx', handler);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  if (!activeFx) return null;

  const isWin = activeFx.amount > 0;
  const formatted = `${isWin ? '+' : '-'}$${Math.abs(activeFx.amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <div
      key={activeFx.id}
      className="fixed inset-0 z-100 pointer-events-none flex items-center justify-center overflow-hidden"
      aria-live="polite"
    >
      {isWin ? (
        <div className="relative flex flex-col items-center justify-center">
          {/* Radial shockwaves */}
          <div className="absolute h-44 w-44 rounded-full border-4 border-amber-400/70 animate-pukun-shockwave" />
          <div
            className="absolute h-36 w-36 rounded-full border-4 border-emerald-400/60 animate-pukun-shockwave"
            style={{ animationDelay: '120ms' }}
          />
          <div className="absolute h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />

          {/* Explosive sparks */}
          {SPARKS.map((s) => (
            <span
              key={s.id}
              className="absolute rounded-full animate-pukun-spark shadow-lg"
              style={
                {
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  backgroundColor: s.color,
                  boxShadow: `0 0 14px ${s.color}`,
                  animationDelay: s.delay,
                  '--tx': s.tx,
                  '--ty': s.ty,
                } as React.CSSProperties
              }
            />
          ))}

          {/* Main Profit Burst Number */}
          <div className="relative animate-pukun-profit flex flex-col items-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-slate-950/90 px-4 py-1 text-xs font-extrabold uppercase tracking-[0.22em] text-amber-300 shadow-lg shadow-amber-500/30 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>{activeFx.label || '¡PROFIT EXPLOSIVO!'}</span>
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <div
              className="font-mono text-5xl sm:text-7xl font-black tracking-tight bg-linear-to-b from-amber-200 via-emerald-300 to-emerald-500 bg-clip-text text-transparent drop-shadow-[0_0_28px_rgba(16,185,129,0.85)] tabular-nums"
            >
              {formatted}
            </div>
            <div className="text-sm font-bold tracking-[0.28em] text-amber-300/95 uppercase mt-1 drop-shadow">
              USDT GANADOS
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col items-center justify-center">
          {/* Dark crimson aura */}
          <div className="absolute h-64 w-72 rounded-full bg-red-700/25 blur-3xl" />

          {/* Main Bleeding Loss Number */}
          <div className="relative animate-pukun-loss flex flex-col items-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-red-500/50 bg-slate-950/90 px-4 py-1 text-xs font-extrabold uppercase tracking-[0.2em] text-red-400 shadow-lg shadow-red-900/50 mb-2">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              <span>{activeFx.label || 'PÉRDIDA EN OPERACIÓN'}</span>
            </div>

            <div className="relative">
              <div className="font-mono text-5xl sm:text-7xl font-black tracking-tight text-red-500 drop-shadow-[0_0_24px_rgba(220,38,38,0.9)] tabular-nums">
                {formatted}
              </div>

              {/* Crimson bleeding droplets falling from the numbers */}
              <div className="absolute left-0 right-0 top-[72%] h-32 overflow-visible">
                {DRIPS.map((d) => (
                  <span
                    key={d.id}
                    className="absolute top-0 w-1.5 rounded-b-full bg-linear-to-b from-red-500 via-red-600 to-red-900 shadow-[0_0_8px_rgba(220,38,38,0.85)] animate-pukun-drip"
                    style={
                      {
                        left: `${d.leftPct}%`,
                        height: `${d.height}px`,
                        animationDelay: d.delay,
                        '--drop-dist': d.dist,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            </div>

            <div className="text-xs font-bold tracking-[0.25em] text-red-400/90 uppercase mt-2">
              USDT
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

