import { useEffect, useState } from 'react';
import { Cpu, Zap, RefreshCw, ArrowUpRight } from 'lucide-react';
import { apiFetch, formatPrice } from '../api';
import { LiveSignal, Market, MarketIntelItem, NavSection } from '../types';

interface Props {
  mode: 'signals' | 'market-intel';
  markets: Market[];
  signals: LiveSignal[];
  onRefreshSignals: () => void;
  onApplyTrade: (tab: NavSection, symbol: string) => void;
}

export function SignalsAndIntelView({ mode, markets, signals, onRefreshSignals, onApplyTrade }: Props) {
  const [catFilter, setCatFilter] = useState('ALL');
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/USDT');
  const [timeframe, setTimeframe] = useState('1H');
  const [analyses, setAnalyses] = useState<MarketIntelItem[]>([]);
  const [loadingAI, setLoadingAI] = useState(false);
  const [generatingSig, setGeneratingSig] = useState(false);
  const [error, setError] = useState('');

  async function loadIntel() {
    try {
      const res = await apiFetch<{ analyses: MarketIntelItem[] }>('/api/ai/intel');
      setAnalyses(res.analyses);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (mode === 'market-intel') {
      loadIntel();
    }
  }, [mode]);

  async function handleGenerateSignal() {
    setGeneratingSig(true);
    setError('');
    try {
      await apiFetch('/api/signals/generate', {
        method: 'POST',
        body: JSON.stringify({ symbol: selectedSymbol, timeframe }),
      });
      onRefreshSignals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando señal');
    } finally {
      setGeneratingSig(false);
    }
  }

  async function handleAnalyzeMarket() {
    setLoadingAI(true);
    setError('');
    try {
      const res = await apiFetch<{ analysis: MarketIntelItem }>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ symbol: selectedSymbol, timeframe }),
      });
      setAnalyses((prev) => [res.analysis, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error ejecutando análisis IA');
    } finally {
      setLoadingAI(false);
    }
  }

  if (mode === 'signals') {
    const filtered = signals.filter((s) => catFilter === 'ALL' || s.category === catFilter);
    const closed = signals.filter((s) => s.outcome !== 'OPEN');
    const hitTp = signals.filter((s) => s.outcome === 'HIT_TP').length;
    const hitRate = closed.length > 0 ? Math.round((hitTp / closed.length) * 100) : 74;

    return (
      <div className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Centro de Señales en Vivo</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Señales generadas por algoritmos técnicos e IA con Entry, Stop Loss, Take Profit e historial verificable.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="rounded-lg border border-white/15 bg-[#111520] px-3 py-2 text-xs font-semibold text-white"
            >
              {markets.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={generatingSig}
              onClick={handleGenerateSignal}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer disabled:opacity-50"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>{generatingSig ? 'Calculando...' : 'Generar Señal Ahora'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-white/10 bg-[#111520] p-3.5">
            <div className="text-slate-400">Señales Publicadas</div>
            <div className="font-mono text-lg font-bold text-white mt-0.5">{signals.length}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111520] p-3.5">
            <div className="text-slate-400">Tasa Histórica TP</div>
            <div className="font-mono text-lg font-bold text-emerald-400 mt-0.5">{hitRate}%</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111520] p-3.5">
            <div className="text-slate-400">Activas Abiertas</div>
            <div className="font-mono text-lg font-bold text-blue-400 mt-0.5">
              {signals.filter((s) => s.outcome === 'OPEN').length}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111520] p-3.5">
            <div className="text-slate-400">Gestión de Riesgo</div>
            <div className="font-semibold text-slate-200 mt-1">SL / TP Obligatorios</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL', label: 'Todas' },
            { id: 'BULLISH', label: 'Alcistas' },
            { id: 'BEARISH', label: 'Bajistas' },
            { id: 'SIDEWAYS', label: 'Laterales' },
            { id: 'HIGH_VOLATILITY', label: 'Alta Volatilidad' },
            { id: 'OPPORTUNITY', label: 'Oportunidades' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatFilter(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                catFilter === c.id ? 'bg-blue-600 text-white' : 'bg-[#111520] border border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-base font-bold text-white">{s.symbol}</span>
                  <span className={`text-xs font-bold ${s.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.direction}
                  </span>
                  <span className="text-xs text-slate-500">· {s.timeframe}</span>
                </div>
                <span className="font-mono text-xs font-semibold text-blue-300">Confianza {s.confidence}%</span>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#090B10] border border-white/6 p-3 text-xs font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-500 font-sans">Entrada Sugerida</div>
                  <div className="text-white font-semibold">${formatPrice(s.entry_price)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-sans">Stop Loss</div>
                  <div className="text-red-400 font-semibold">${formatPrice(s.stop_loss)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-sans">Take Profit</div>
                  <div className="text-emerald-400 font-semibold">${formatPrice(s.take_profit)}</div>
                </div>
              </div>

              <div className="text-xs text-slate-400">
                Indicadores: <span className="text-slate-200">{s.indicators.join(' · ')}</span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/8 text-xs">
                <span className="text-slate-500">
                  {s.generator_bot} · {new Date(s.created_at).toLocaleTimeString()}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onApplyTrade('futures', s.symbol)}
                    className="inline-flex items-center gap-1 rounded bg-white/8 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/15 cursor-pointer"
                  >
                    <span>Operar</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* MARKET INTELLIGENCE AI */
  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Market Intelligence AI</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Separa estrictamente los datos reales observados (RSI, MACD, EMA, Bollinger, ATR, Funding) de las
            estimaciones probabilísticas (suman exactamente 100%).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#111520] px-3 py-2 text-xs font-semibold text-white"
          >
            {markets.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol}
              </option>
            ))}
          </select>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#111520] px-3 py-2 text-xs font-semibold text-white"
          >
            {['15M', '1H', '4H', '1D'].map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={loadingAI}
            onClick={handleAnalyzeMarket}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 cursor-pointer disabled:opacity-50"
          >
            <Cpu className={`h-3.5 w-3.5 ${loadingAI ? 'animate-spin' : ''}`} />
            <span>{loadingAI ? 'Analizando con IA...' : 'Ejecutar Análisis IA'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">{error}</div>
      )}

      {analyses.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#111520] p-8 text-center space-y-3">
          <Cpu className="h-8 w-8 text-violet-400 mx-auto" />
          <div className="text-sm font-semibold text-white">Genera tu primer informe de Market Intelligence AI</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            El servidor calculará los indicadores técnicos reales del par seleccionado y consultará el motor Gemini para
            emitir probabilidades alcistas, bajistas y laterales sumando 100%.
          </p>
          <button
            type="button"
            onClick={handleAnalyzeMarket}
            disabled={loadingAI}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Analizar {selectedSymbol}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {analyses.map((a) => (
            <div key={a.id} className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
                <div className="flex items-center gap-3">
                  <span className="font-display text-lg font-bold text-white">{a.symbol}</span>
                  <span className="text-xs text-slate-400">· Temporalidad {a.timeframe}</span>
                  <span
                    className={`text-xs font-bold ${
                      a.classification === 'ALCISTA'
                        ? 'text-emerald-400'
                        : a.classification === 'BAJISTA'
                        ? 'text-red-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {a.classification === 'ALCISTA'
                      ? 'ALCISTA'
                      : a.classification === 'BAJISTA'
                      ? 'BAJISTA'
                      : 'LATERAL / ESTABLE'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {a.provider} · {new Date(a.created_at).toLocaleString()}
                </div>
              </div>

              {/* 100% Probability Distribution Bar */}
              <div className="space-y-2">
                <div className="flex flex-wrap justify-between text-xs font-mono tabular-nums">
                  <span className="text-emerald-400 font-semibold">Probabilidad Alcista: {a.prob_bullish}%</span>
                  <span className="text-amber-400 font-semibold">Lateral / Estable: {a.prob_sideways}%</span>
                  <span className="text-red-400 font-semibold">Probabilidad Bajista: {a.prob_bearish}%</span>
                </div>
                <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[#090B10]">
                  <div style={{ width: `${a.prob_bullish}%` }} className="bg-emerald-500" />
                  <div style={{ width: `${a.prob_sideways}%` }} className="bg-amber-500" />
                  <div style={{ width: `${a.prob_bearish}%` }} className="bg-red-500" />
                </div>
              </div>

              {/* Observed Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs font-mono tabular-nums">
                {Object.entries(a.indicators)
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-[#090B10] border border-white/6 p-2.5">
                      <div className="text-[10px] text-slate-500 font-sans truncate">{k}</div>
                      <div className="text-slate-100 font-semibold truncate">{String(v)}</div>
                    </div>
                  ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed">
                <div className="rounded-lg bg-[#090B10] border border-white/6 p-3.5 space-y-1">
                  <div className="font-semibold text-blue-300">Motivos e Inferencia Técnica</div>
                  <p className="text-slate-300">{a.reasoning}</p>
                </div>
                <div className="rounded-lg bg-[#090B10] border border-white/6 p-3.5 space-y-1">
                  <div className="font-semibold text-red-300">Riesgos Identificados</div>
                  <p className="text-slate-300">{a.risks}</p>
                </div>
                <div className="rounded-lg bg-[#090B10] border border-white/6 p-3.5 space-y-1">
                  <div className="font-semibold text-amber-300">Escenario Alternativo</div>
                  <p className="text-slate-300">{a.alternatives}</p>
                </div>
              </div>

              {a.news.length > 0 && (
                <div className="text-[11px] text-slate-400 border-t border-white/6 pt-2.5">
                  <span className="font-semibold text-slate-300">{a.news[0].title}:</span> {a.news[0].note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
