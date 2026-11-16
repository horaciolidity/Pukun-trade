import { Fragment, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter,
  Search,
  Trophy,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { formatCurrency, formatPrice, getStoredToken } from '../api';
import { QuickTradeItem, QuickTradePnlPoint, TradingEnv } from '../types';
import { formatCountdown, formatDurationLabel, QuickTradeThermalColors, DEFAULT_THERMAL_COLORS } from '../utils/quickTradeMath';

interface Props {
  env: TradingEnv;
  trades: QuickTradeItem[]; // Current env or ALL trades passed from parent
  currentBalance: number;
  nowMs: number;
  accountFilter: 'CURRENT' | 'DEMO' | 'REAL' | 'ALL';
  onAccountFilterChange: (f: 'CURRENT' | 'DEMO' | 'REAL' | 'ALL') => void;
  thermalColors?: QuickTradeThermalColors;
  animationsEnabled?: boolean;
}

type PeriodMode = 'DAILY' | 'WEEKLY' | 'MONTHLY';

function formatDateOnly(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function formatTimeOnly(ts: number): string {
  if (!ts || ts <= 0) return '—';
  return new Date(ts).toLocaleTimeString('es-ES', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function mapDisplayResult(status: QuickTradeItem['status']): 'WIN' | 'LOSS' | 'DRAW' | 'CANCELADA' | 'EN CURSO' {
  if (status === 'WON') return 'WIN';
  if (status === 'LOST') return 'LOSS';
  if (status === 'DRAW') return 'DRAW';
  if (status === 'CANCELLED') return 'CANCELADA';
  return 'EN CURSO';
}

function parsePnlPoints(raw?: string): QuickTradePnlPoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function QuickTradeStatsAndHistory({
  env,
  trades,
  currentBalance,
  nowMs,
  accountFilter,
  onAccountFilterChange,
  thermalColors = DEFAULT_THERMAL_COLORS,
  animationsEnabled = true,
}: Props) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>('DAILY');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // History Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<'ALL' | 'TODAY' | '7D' | '30D' | 'CUSTOM'>('ALL');
  const [customDate, setCustomDate] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [dirFilter, setDirFilter] = useState<'ALL' | 'UP' | 'DOWN'>('ALL');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'WIN' | 'LOSS' | 'DRAW' | 'CANCELADA' | 'ACTIVE'>('ALL');
  const [durationFilter, setDurationFilter] = useState<string>('ALL');
  const [pnlRangeFilter, setPnlRangeFilter] = useState<'ALL' | 'PROFIT' | 'LOSS' | 'BIG_WIN' | 'BIG_LOSS'>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const uniqueSymbols = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => set.add(t.symbol));
    return Array.from(set).sort();
  }, [trades]);

  // Filtered list for both history table and period awareness
  const filteredTrades = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    return trades.filter((t) => {
      if (accountFilter === 'DEMO' && t.env !== 'DEMO') return false;
      if (accountFilter === 'REAL' && t.env !== 'REAL') return false;
      if (accountFilter === 'CURRENT' && t.env !== env) return false;

      if (symbolFilter !== 'ALL' && t.symbol !== symbolFilter) return false;
      if (dirFilter !== 'ALL' && t.direction !== dirFilter) return false;
      if (durationFilter !== 'ALL' && String(t.duration_sec) !== durationFilter) return false;

      const resLabel = mapDisplayResult(t.status);
      if (resultFilter === 'ACTIVE' && t.status !== 'ACTIVE') return false;
      if (resultFilter !== 'ALL' && resultFilter !== 'ACTIVE' && resLabel !== resultFilter) return false;

      if (pnlRangeFilter === 'PROFIT' && t.profit <= 0) return false;
      if (pnlRangeFilter === 'LOSS' && t.profit >= 0) return false;
      if (pnlRangeFilter === 'BIG_WIN' && t.profit < 25) return false;
      if (pnlRangeFilter === 'BIG_LOSS' && t.profit > -25) return false;

      if (datePreset === 'TODAY' && t.created_at < todayMs) return false;
      if (datePreset === '7D' && t.created_at < nowMs - 7 * 86400000) return false;
      if (datePreset === '30D' && t.created_at < nowMs - 30 * 86400000) return false;
      if (datePreset === 'CUSTOM' && customDate && formatDateOnly(t.created_at) !== customDate) return false;

      if (q) {
        const hay = `${t.id} ${t.symbol} ${t.price_source || ''} ${t.cancel_reason || ''} ${t.env}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    trades,
    accountFilter,
    env,
    symbolFilter,
    dirFilter,
    durationFilter,
    resultFilter,
    pnlRangeFilter,
    datePreset,
    customDate,
    searchQuery,
    nowMs,
  ]);

  // Performance Statistics (computed on filtered/account trades that are settled)
  const stats = useMemo(() => {
    const closed = filteredTrades.filter((t) => t.status !== 'ACTIVE' && t.status !== 'CANCELLED');
    const wins = closed.filter((t) => t.status === 'WON');
    const losses = closed.filter((t) => t.status === 'LOST');

    const totalGains = wins.reduce((s, t) => s + t.profit, 0);
    const totalLosses = losses.reduce((s, t) => s + Math.abs(t.profit), 0);
    const netPnl = closed.reduce((s, t) => s + t.profit, 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgGain = wins.length > 0 ? totalGains / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    const bestTrade = closed.length > 0 ? closed.reduce((a, b) => (b.profit > a.profit ? b : a), closed[0]) : null;
    const worstTrade = closed.length > 0 ? closed.reduce((a, b) => (b.profit < a.profit ? b : a), closed[0]) : null;

    // Streak calculation (from newest closed trade backwards)
    let streakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
    let streakCount = 0;
    for (const t of closed) {
      if (t.status === 'DRAW') continue;
      const curType = t.status === 'WON' ? 'WIN' : 'LOSS';
      if (streakType === 'NONE') {
        streakType = curType;
        streakCount = 1;
      } else if (streakType === curType) {
        streakCount++;
      } else {
        break;
      }
    }

    const initialPeriodBalance = Math.max(0, currentBalance - netPnl);

    return {
      initialPeriodBalance,
      totalGains,
      totalLosses,
      netPnl,
      totalCount: filteredTrades.length,
      settledCount: closed.length,
      winsCount: wins.length,
      lossesCount: losses.length,
      winRate,
      avgGain,
      avgLoss,
      bestTrade,
      worstTrade,
      streakType,
      streakCount,
    };
  }, [filteredTrades, currentBalance]);

  // Cumulative PnL buckets for Daily / Weekly / Monthly chart
  const cumulativeSeries = useMemo(() => {
    const settled = filteredTrades
      .filter((t) => t.status === 'WON' || t.status === 'LOST' || t.status === 'DRAW')
      .slice()
      .sort((a, b) => (a.closed_at || a.expires_at) - (b.closed_at || b.expires_at));

    const buckets = new Map<string, number>();
    for (const t of settled) {
      const ts = t.closed_at || t.expires_at;
      const d = new Date(ts);
      let key = '';
      if (periodMode === 'DAILY') {
        key = d.toISOString().slice(0, 10);
      } else if (periodMode === 'WEEKLY') {
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
        key = `Sem ${mon.toISOString().slice(5, 10)}`;
      } else {
        key = d.toISOString().slice(0, 7);
      }
      buckets.set(key, (buckets.get(key) || 0) + t.profit);
    }

    let running = 0;
    return Array.from(buckets.entries()).map(([label, delta]) => {
      running = Number((running + delta).toFixed(2));
      return { label, delta: Number(delta.toFixed(2)), cumulative: running };
    });
  }, [filteredTrades, periodMode]);

  // Asset & Duration breakdown
  const comparisons = useMemo(() => {
    const closed = filteredTrades.filter((t) => t.status === 'WON' || t.status === 'LOST' || t.status === 'DRAW');
    const byAsset = new Map<string, { count: number; wins: number; pnl: number }>();
    const byDuration = new Map<number, { count: number; wins: number; pnl: number }>();

    for (const t of closed) {
      const a = byAsset.get(t.symbol) || { count: 0, wins: 0, pnl: 0 };
      a.count++;
      if (t.status === 'WON') a.wins++;
      a.pnl = Number((a.pnl + t.profit).toFixed(2));
      byAsset.set(t.symbol, a);

      const d = byDuration.get(t.duration_sec) || { count: 0, wins: 0, pnl: 0 };
      d.count++;
      if (t.status === 'WON') d.wins++;
      d.pnl = Number((d.pnl + t.profit).toFixed(2));
      byDuration.set(t.duration_sec, d);
    }

    return {
      assets: Array.from(byAsset.entries()).sort((a, b) => b[1].count - a[1].count),
      durations: Array.from(byDuration.entries()).sort((a, b) => a[0] - b[0]),
    };
  }, [filteredTrades]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedTrades = filteredTrades.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const targetEnv = accountFilter === 'CURRENT' ? env : accountFilter;
      const token = getStoredToken();
      const res = await fetch(`/api/quick-trade/export-csv?env=${targetEnv}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Error exportando CSV');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quick-trading-${targetEnv.toLowerCase()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      setExporting(false);
    }
  }

  // SVG Geometry for Cumulative PnL Chart
  const chartW = 540;
  const chartH = 140;
  const cumValues = cumulativeSeries.map((s) => s.cumulative);
  const cumMin = Math.min(0, ...(cumValues.length ? cumValues : [0]));
  const cumMax = Math.max(0, ...(cumValues.length ? cumValues : [0]));
  const cumSpan = Math.max(10, cumMax - cumMin);
  const zeroY = chartH - 16 - ((0 - cumMin) / cumSpan) * (chartH - 32);

  const svgPoints = cumulativeSeries
    .map((pt, idx) => {
      const x =
        cumulativeSeries.length === 1
          ? chartW / 2
          : 16 + (idx / (cumulativeSeries.length - 1)) * (chartW - 32);
      const y = chartH - 16 - ((pt.cumulative - cumMin) / cumSpan) * (chartH - 32);
      return { x, y, ...pt };
    });

  return (
    <div className="space-y-4">
      {/* SECTION 6: PERFORMANCE STATISTICS & CUMULATIVE EVOLUTION */}
      <div className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span>Estadísticas de Rendimiento Quick Trading</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Cálculo verificado sobre operaciones liquidadas ({accountFilter === 'CURRENT' ? env : accountFilter}).
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPeriodMode(m)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono cursor-pointer transition-colors ${
                  periodMode === m
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40 font-semibold'
                    : 'bg-[#080B11] text-slate-400 border border-white/8 hover:text-white'
                }`}
              >
                {m === 'DAILY' ? 'Diario' : m === 'WEEKLY' ? 'Semanal' : 'Mensual'}
              </button>
            ))}
          </div>
        </div>

        {/* 13 KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Balance Inicial Período</div>
            <div className="font-mono font-bold text-white tabular-nums mt-0.5">
              ${formatCurrency(stats.initialPeriodBalance)}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Ganancias Totales</div>
            <div className="font-mono font-bold text-emerald-400 tabular-nums mt-0.5">
              +${formatCurrency(stats.totalGains)}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Pérdidas Totales</div>
            <div className="font-mono font-bold text-red-400 tabular-nums mt-0.5">
              -${formatCurrency(stats.totalLosses)}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">PnL Neto</div>
            <div
              className={`font-mono font-bold tabular-nums mt-0.5 ${
                stats.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {stats.netPnl >= 0 ? '+' : '-'}${formatCurrency(Math.abs(stats.netPnl))}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Aciertos (Win Rate)</div>
            <div className="font-mono font-bold text-sky-400 tabular-nums mt-0.5">
              {stats.winRate.toFixed(1)}% ({stats.winsCount}G / {stats.lossesCount}P)
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Racha Actual</div>
            <div
              className={`font-mono font-bold tabular-nums mt-0.5 ${
                stats.streakType === 'WIN'
                  ? 'text-emerald-400'
                  : stats.streakType === 'LOSS'
                  ? 'text-red-400'
                  : 'text-slate-400'
              }`}
            >
              {stats.streakType === 'NONE'
                ? 'Sin racha'
                : `${stats.streakCount} ${stats.streakType === 'WIN' ? 'Victorias' : 'Derrotas'}`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Total Operaciones</div>
            <div className="font-mono font-semibold text-white tabular-nums mt-0.5">{stats.totalCount}</div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Promedio Ganancia</div>
            <div className="font-mono font-semibold text-emerald-400 tabular-nums mt-0.5">
              +${formatCurrency(stats.avgGain)}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Promedio Pérdida</div>
            <div className="font-mono font-semibold text-red-400 tabular-nums mt-0.5">
              -${formatCurrency(stats.avgLoss)}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Mejor Operación</div>
            <div className="font-mono font-semibold text-emerald-400 tabular-nums mt-0.5">
              {stats.bestTrade
                ? `${stats.bestTrade.profit >= 0 ? '+' : ''}$${stats.bestTrade.profit.toFixed(2)} (${stats.bestTrade.symbol})`
                : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#080B11] border border-white/6 p-2.5">
            <div className="text-[10px] text-slate-400">Peor Operación</div>
            <div className="font-mono font-semibold text-red-400 tabular-nums mt-0.5">
              {stats.worstTrade
                ? `${stats.worstTrade.profit >= 0 ? '+' : ''}$${stats.worstTrade.profit.toFixed(2)} (${stats.worstTrade.symbol})`
                : '—'}
            </div>
          </div>
        </div>

        {/* Cumulative PnL Evolution Chart + Asset/Duration Comparisons */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Cumulative PnL Curve */}
          <div className="lg:col-span-6 rounded-xl border border-white/8 bg-[#080B11] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-200">
                Evolución Acumulada del PnL ({periodMode === 'DAILY' ? 'Diario' : periodMode === 'WEEKLY' ? 'Semanal' : 'Mensual'})
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {cumulativeSeries.length} {cumulativeSeries.length === 1 ? 'período' : 'períodos'}
              </span>
            </div>
            {cumulativeSeries.length === 0 ? (
              <div className="h-[140px] flex items-center justify-center text-xs text-slate-500">
                Ejecuta y cierra operaciones para visualizar la curva acumulada.
              </div>
            ) : (
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-[140px]">
                <line
                  x1="12"
                  y1={zeroY}
                  x2={chartW - 12}
                  y2={zeroY}
                  stroke="rgba(148,163,184,0.35)"
                  strokeDasharray="4 4"
                />
                {svgPoints.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={stats.netPnl >= 0 ? thermalColors.highProfit : thermalColors.highLoss}
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    points={svgPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  />
                )}
                {svgPoints.map((p) => (
                  <g key={p.label}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="3.8"
                      fill={p.cumulative >= 0 ? thermalColors.highProfit : thermalColors.highLoss}
                      stroke="#080B11"
                      strokeWidth="1.5"
                    />
                    <text x={p.x} y={chartH - 3} textAnchor="middle" fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">
                      {p.label.slice(-5)}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>

          {/* Asset & Duration Comparison */}
          <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/8 bg-[#080B11] p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Comparativa por Criptomoneda</div>
              {comparisons.assets.length === 0 ? (
                <div className="text-[11px] text-slate-500 py-6 text-center">Sin operaciones liquidadas aún.</div>
              ) : (
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                  {comparisons.assets.map(([sym, item]) => {
                    const wr = item.count > 0 ? (item.wins / item.count) * 100 : 0;
                    return (
                      <div key={sym} className="flex items-center justify-between text-[11px] font-mono py-1 border-b border-white/5 last:border-0">
                        <div>
                          <span className="font-sans font-semibold text-white">{sym}</span>
                          <span className="text-slate-500 ml-1.5">
                            {item.count} ops · {wr.toFixed(0)}%
                          </span>
                        </div>
                        <span className={item.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                          {item.pnl >= 0 ? '+' : ''}
                          ${item.pnl.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/8 bg-[#080B11] p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Comparativa por Duración</div>
              {comparisons.durations.length === 0 ? (
                <div className="text-[11px] text-slate-500 py-6 text-center">Sin operaciones liquidadas aún.</div>
              ) : (
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                  {comparisons.durations.map(([dur, item]) => {
                    const wr = item.count > 0 ? (item.wins / item.count) * 100 : 0;
                    return (
                      <div key={dur} className="flex items-center justify-between text-[11px] font-mono py-1 border-b border-white/5 last:border-0">
                        <div>
                          <span className="font-sans font-semibold text-white">{formatDurationLabel(dur)}</span>
                          <span className="text-slate-500 ml-1.5">
                            {item.count} ops · {wr.toFixed(0)}%
                          </span>
                        </div>
                        <span className={item.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                          {item.pnl >= 0 ? '+' : ''}
                          ${item.pnl.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 5: ADVANCED EXPANDABLE HISTORY + FILTERS + SEARCH + PAGINATION */}
      <div className="rounded-xl border border-white/10 bg-[#111520] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Filter className="h-4 w-4 text-sky-400" />
              <span>Historial Avanzado y Verificable</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Haz clic en cualquier operación para desplegar los 20 campos auditables y su trayectoria de PnL.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">{filteredTrades.length} registros</span>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#080B11] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white hover:border-sky-400/50 cursor-pointer disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-sky-400" />
              <span>{exporting ? 'Exportando...' : 'Exportar CSV'}</span>
            </button>
          </div>
        </div>

        {/* Multi-criteria Filters Toolbar */}
        <div className="p-3.5 bg-[#0C1019] border-b border-white/8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2 text-xs">
          <div className="relative xl:col-span-2">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar por ID, par o fuente..."
              className="w-full rounded-lg border border-white/10 bg-[#080B11] pl-8 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <select
            value={accountFilter}
            onChange={(e) => {
              onAccountFilterChange(e.target.value as 'CURRENT' | 'DEMO' | 'REAL' | 'ALL');
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-[#080B11] px-2.5 py-2 text-xs text-white"
          >
            <option value="CURRENT">Cuenta Actual ({env})</option>
            <option value="DEMO">Solo DEMO</option>
            <option value="REAL">Solo REAL</option>
            <option value="ALL">DEMO + REAL</option>
          </select>

          <select
            value={symbolFilter}
            onChange={(e) => {
              setSymbolFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-[#080B11] px-2.5 py-2 text-xs text-white"
          >
            <option value="ALL">Todas las Criptos</option>
            {uniqueSymbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={dirFilter}
            onChange={(e) => {
              setDirFilter(e.target.value as 'ALL' | 'UP' | 'DOWN');
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-[#080B11] px-2.5 py-2 text-xs text-white"
          >
            <option value="ALL">UP y DOWN</option>
            <option value="UP">Solo UP (Alcista)</option>
            <option value="DOWN">Solo DOWN (Bajista)</option>
          </select>

          <select
            value={resultFilter}
            onChange={(e) => {
              setResultFilter(e.target.value as typeof resultFilter);
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-[#080B11] px-2.5 py-2 text-xs text-white"
          >
            <option value="ALL">Todos Resultados</option>
            <option value="WIN">WIN (Ganadas)</option>
            <option value="LOSS">LOSS (Perdidas)</option>
            <option value="DRAW">DRAW (Empate)</option>
            <option value="CANCELADA">CANCELADA</option>
            <option value="ACTIVE">EN CURSO</option>
          </select>

          <select
            value={durationFilter}
            onChange={(e) => {
              setDurationFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-[#080B11] px-2.5 py-2 text-xs text-white"
          >
            <option value="ALL">Todas Duraciones</option>
            {[15, 30, 60, 180, 300, 600].map((sec) => (
              <option key={sec} value={String(sec)}>
                {formatDurationLabel(sec)}
              </option>
            ))}
          </select>

          <select
            value={pnlRangeFilter}
            onChange={(e) => {
              setPnlRangeFilter(e.target.value as typeof pnlRangeFilter);
              setPage(1);
            }}
            className="rounded-lg border border-white/10 bg-[#080B11] px-2.5 py-2 text-xs text-white"
          >
            <option value="ALL">Rango PnL: Todos</option>
            <option value="PROFIT">Ganancias (&gt; $0)</option>
            <option value="LOSS">Pérdidas (&lt; $0)</option>
            <option value="BIG_WIN">Ganancias &ge; $25</option>
            <option value="BIG_LOSS">Pérdidas &le; -$25</option>
          </select>
        </div>

        {/* Date Filter Bar */}
        <div className="px-3.5 py-2 bg-[#090D15] border-b border-white/8 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-slate-400">Fecha:</span>
          {(
            [
              { id: 'ALL', label: 'Todo' },
              { id: 'TODAY', label: 'Hoy' },
              { id: '7D', label: '7 días' },
              { id: '30D', label: '30 días' },
              { id: 'CUSTOM', label: 'Día exacto' },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDatePreset(d.id);
                setPage(1);
              }}
              className={`px-2 py-1 rounded cursor-pointer font-mono ${
                datePreset === d.id ? 'bg-sky-500/20 text-sky-300 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {d.label}
            </button>
          ))}
          {datePreset === 'CUSTOM' && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setPage(1);
              }}
              className="rounded border border-white/15 bg-[#080B11] px-2 py-1 text-[11px] font-mono text-white"
            />
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {pagedTrades.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No hay operaciones que coincidan con los filtros seleccionados.
            </div>
          ) : (
            <table className="w-full text-left text-xs min-w-[920px]">
              <thead>
                <tr className="border-b border-white/8 text-[11px] text-slate-400">
                  <th className="py-2.5 px-3 w-8" />
                  <th className="py-2.5 px-3">Fecha / Apertura</th>
                  <th className="py-2.5 px-3">Cuenta</th>
                  <th className="py-2.5 px-3">Cripto</th>
                  <th className="py-2.5 px-3">Dirección</th>
                  <th className="py-2.5 px-3 text-right">Duración</th>
                  <th className="py-2.5 px-3 text-right">Importe</th>
                  <th className="py-2.5 px-3 text-right">Entrada → Cierre</th>
                  <th className="py-2.5 px-3 text-right">Payout</th>
                  <th className="py-2.5 px-3">Resultado</th>
                  <th className="py-2.5 px-3 text-right">PnL / Rend.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6 font-mono tabular-nums">
                {pagedTrades.map((qt) => {
                  const isExpanded = expandedId === qt.id;
                  const resLabel = mapDisplayResult(qt.status);
                  const rem = qt.status === 'ACTIVE' ? Math.max(0, Math.ceil((qt.expires_at - nowMs) / 1000)) : 0;
                  const retPct =
                    qt.return_pct !== undefined && qt.status !== 'ACTIVE'
                      ? qt.return_pct
                      : qt.amount > 0 && qt.status !== 'ACTIVE'
                      ? Number(((qt.profit / qt.amount) * 100).toFixed(2))
                      : 0;
                  const pnlPts = parsePnlPoints(qt.pnl_history_json);

                  const rowTint =
                    qt.status === 'WON'
                      ? animationsEnabled
                        ? 'bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07]'
                        : 'hover:bg-white/[0.02]'
                      : qt.status === 'LOST'
                      ? animationsEnabled
                        ? 'bg-red-500/[0.03] hover:bg-red-500/[0.07]'
                        : 'hover:bg-white/[0.02]'
                      : 'hover:bg-white/[0.02]';

                  return (
                    <Fragment key={qt.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : qt.id)}
                        className={`cursor-pointer transition-colors ${rowTint}`}
                      >
                        <td className="py-2.5 px-3 text-slate-400">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-300">
                          <div>{formatDateOnly(qt.created_at)}</div>
                          <div className="text-[10px] text-slate-500">{formatTimeOnly(qt.created_at)}</div>
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              qt.env === 'DEMO' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {qt.env}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-sans font-semibold text-white whitespace-nowrap">
                          {qt.symbol}
                        </td>
                        <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              qt.direction === 'UP' ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {qt.direction === 'UP' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {qt.direction}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">{formatDurationLabel(qt.duration_sec)}</td>
                        <td className="py-2.5 px-3 text-right text-slate-200">${qt.amount.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap text-slate-300">
                          ${formatPrice(qt.entry_price)} →{' '}
                          {qt.close_price > 0 ? `$${formatPrice(qt.close_price)}` : `${formatCountdown(rem)}`}
                        </td>
                        <td className="py-2.5 px-3 text-right text-sky-300">{qt.payout_pct}%</td>
                        <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                          <span
                            className={`font-bold text-[11px] ${
                              resLabel === 'WIN'
                                ? 'text-emerald-400'
                                : resLabel === 'LOSS'
                                ? 'text-red-400'
                                : resLabel === 'CANCELADA'
                                ? 'text-amber-300'
                                : resLabel === 'DRAW'
                                ? 'text-slate-300'
                                : 'text-sky-400'
                            }`}
                          >
                            {resLabel === 'EN CURSO' ? `EN CURSO (${rem}s)` : resLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {qt.status === 'ACTIVE' ? (
                            <span className="text-sky-400">En vivo</span>
                          ) : (
                            <div>
                              <div
                                className={`font-bold ${
                                  qt.profit > 0 ? 'text-emerald-400' : qt.profit < 0 ? 'text-red-400' : 'text-slate-300'
                                }`}
                              >
                                {qt.profit >= 0 ? '+' : ''}
                                {qt.profit.toFixed(2)} USDT
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {retPct >= 0 ? '+' : ''}
                                {retPct.toFixed(2)}%
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Expanded 20-Field Audit Details & Trajectory */}
                      {isExpanded && (
                        <tr className="bg-[#080B11]/90">
                          <td colSpan={11} className="p-4">
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                              <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-sans">
                                <div>
                                  <span className="text-slate-500 block">ID Único</span>
                                  <span className="font-mono text-slate-200">{qt.id}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Fecha</span>
                                  <span className="font-mono text-slate-200">{formatDateOnly(qt.created_at)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Hora Apertura / Cierre</span>
                                  <span className="font-mono text-slate-200">
                                    {formatTimeOnly(qt.created_at)} → {formatTimeOnly(qt.closed_at || 0)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Tiempo Efectivo</span>
                                  <span className="font-mono text-slate-200">
                                    {qt.effective_duration_sec || qt.duration_sec}s (prog. {qt.duration_sec}s)
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Precio Exacto Entrada</span>
                                  <span className="font-mono text-slate-200">${formatPrice(qt.entry_price)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Precio Exacto Cierre</span>
                                  <span className="font-mono text-slate-200">
                                    {qt.close_price > 0 ? `$${formatPrice(qt.close_price)}` : 'Pendiente'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Máx. PnL Positivo</span>
                                  <span className="font-mono text-emerald-400">
                                    +${Number(qt.max_positive_pnl || 0).toFixed(2)} USDT
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Máx. PnL Negativo</span>
                                  <span className="font-mono text-red-400">
                                    -${Math.abs(Number(qt.max_negative_pnl || 0)).toFixed(2)} USDT
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Tipo de Cuenta</span>
                                  <span className="font-mono text-white">{qt.env}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Fuente de Cotización</span>
                                  <span className="font-mono text-sky-300">{qt.price_source || 'SIMULATED_FEED'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Payout / Rendimiento</span>
                                  <span className="font-mono text-slate-200">
                                    {qt.payout_pct}% / {retPct >= 0 ? '+' : ''}
                                    {retPct.toFixed(2)}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block">Motivo Cancelación</span>
                                  <span className="text-amber-300">{qt.cancel_reason || 'No aplica'}</span>
                                </div>
                              </div>

                              {/* Mini Trajectory Sparkline */}
                              <div className="lg:col-span-4 rounded-lg border border-white/8 bg-[#0D121D] p-2.5">
                                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                                  <span>Trayectoria PnL Registrada</span>
                                  <span className="font-mono">{pnlPts.length} puntos</span>
                                </div>
                                {pnlPts.length >= 2 ? (
                                  (() => {
                                    const vals = pnlPts.map((x) => x.pnl);
                                    const mn = Math.min(0, ...vals);
                                    const mx = Math.max(0, ...vals);
                                    const sp = Math.max(1, mx - mn);
                                    const zY = 58 - ((0 - mn) / sp) * 48;
                                    const poly = pnlPts
                                      .map((p, idx) => {
                                        const x = 6 + (idx / (pnlPts.length - 1)) * 208;
                                        const y = 58 - ((p.pnl - mn) / sp) * 48;
                                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                                      })
                                      .join(' ');
                                    return (
                                      <svg viewBox="0 0 220 66" className="w-full h-[66px]">
                                        <line x1="4" y1={zY} x2="216" y2={zY} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" />
                                        <polyline
                                          fill="none"
                                          stroke={qt.profit >= 0 ? thermalColors.highProfit : thermalColors.highLoss}
                                          strokeWidth="1.8"
                                          points={poly}
                                        />
                                      </svg>
                                    );
                                  })()
                                ) : (
                                  <div className="h-[66px] flex items-center justify-center text-[10px] text-slate-500">
                                    {qt.status === 'ACTIVE' ? 'Capturando trayectoria...' : 'Registro anterior a telemetría extendida'}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-white/8 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span>Filas:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-white/10 bg-[#080B11] px-2 py-1 font-mono text-xs text-white"
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <span className="text-slate-400">
              Página {safePage} de {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-white/10 bg-[#080B11] text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded border border-white/10 bg-[#080B11] text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
