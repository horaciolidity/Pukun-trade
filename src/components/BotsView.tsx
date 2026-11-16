import { useState } from 'react';
import { Bot, Play, Pause, Square, Settings2, BarChart3 } from 'lucide-react';
import { apiFetch, formatCurrency } from '../api';
import { Market, TradingBot, TradingEnv } from '../types';

interface Props {
  env: TradingEnv;
  markets: Market[];
  bots: TradingBot[];
  templates: TradingBot[];
  onRefresh: () => void;
}

const BOT_TYPE_LABELS: Record<string, string> = {
  SCALPING: 'Scalping Bot',
  TREND: 'Trend Following Bot',
  GRID: 'Grid Bot',
  DCA: 'DCA Bot',
  ARBITRAGE: 'Arbitrage Bot',
  AI_PREDICTIVE: 'AI Predictive Bot',
  SMART_FUTURES: 'Smart Futures Bot',
};

export function BotsView({ env, markets, bots, templates, onRefresh }: Props) {
  const [configuringBot, setConfiguringBot] = useState<TradingBot | null>(null);
  const [formName, setFormName] = useState('');
  const [formSymbol, setFormSymbol] = useState('BTC/USDT');
  const [formAlloc, setFormAlloc] = useState('500');
  const [formRisk, setFormRisk] = useState('MEDIO');
  const [compareMode, setCompareMode] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function handleTryTemplateInDemo(tpl: TradingBot) {
    setFeedback(null);
    try {
      await apiFetch('/api/bots/create', {
        method: 'POST',
        body: JSON.stringify({
          env,
          botType: tpl.bot_type,
          name: `${tpl.name} (${env})`,
          symbol: tpl.symbol,
          allocatedUsdt: 500,
          riskLevel: tpl.risk_level,
          config: JSON.parse(tpl.config_json || '{}'),
        }),
      });
      setFeedback({ type: 'ok', text: `${tpl.name} activado en ${env} con 500 USDT.` });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'No se pudo activar el bot' });
    }
  }

  async function handleBotStatus(botId: string, status: 'ACTIVE' | 'PAUSED' | 'STOPPED') {
    setFeedback(null);
    try {
      await apiFetch(`/api/bots/${botId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al actualizar bot' });
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!configuringBot) return;
    try {
      await apiFetch(`/api/bots/${configuringBot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          symbol: formSymbol,
          allocatedUsdt: parseFloat(formAlloc) || 500,
        }),
      });
      setConfiguringBot(null);
      setFeedback({ type: 'ok', text: 'Configuración del bot actualizada.' });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando configuración' });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-white">AI Trading Bots ({env})</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Los porcentajes históricos corresponden a backtests previos y no garantizan rendimientos futuros. Distingue
            siempre entre simulaciones DEMO y ejecución real.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCompareMode(!compareMode)}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-semibold cursor-pointer ${
            compareMode ? 'border-blue-500 bg-blue-600 text-white' : 'border-white/15 bg-[#111520] text-slate-200 hover:bg-[#192030]'
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          <span>{compareMode ? 'Ver Tarjetas' : 'Comparar Estrategias'}</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl px-4 py-3 text-xs border ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Strategy Comparison Matrix */}
      {compareMode ? (
        <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[780px]">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-3 px-4">Bot / Tipo</th>
                <th className="py-3 px-4">Estrategia</th>
                <th className="py-3 px-4">Riesgo</th>
                <th className="py-3 px-4 text-right">Backtest Histórico</th>
                <th className="py-3 px-4 text-right">Aciertos Simulados</th>
                <th className="py-3 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {templates.map((t) => {
                const winRate = t.trades_count > 0 ? Math.round((t.wins_count / t.trades_count) * 100) : 65;
                return (
                  <tr key={t.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{t.name}</div>
                      <div className="text-[11px] text-slate-500">{BOT_TYPE_LABELS[t.bot_type] || t.bot_type}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-xs">{t.strategy_summary}</td>
                    <td className="py-3 px-4 font-semibold text-amber-300">{t.risk_level}</td>
                    <td className="py-3 px-4 text-right font-mono text-blue-300">+{t.historical_backtest_pct}% (Backtest)</td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-400">{winRate}% ({t.trades_count} ops)</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleTryTemplateInDemo(t)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
                      >
                        Probar en {env}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* My Active / Configured Bots */
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-base font-semibold text-white mb-3">Tus Bots Configurados ({bots.length})</h2>
            {bots.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#111520] p-6 text-center text-xs text-slate-400">
                No tienes bots instanciados en {env}. Selecciona uno de los 7 algoritmos de la galería inferior para probarlo.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {bots.map((b) => {
                  const winRate = b.trades_count > 0 ? Math.round((b.wins_count / b.trades_count) * 100) : 0;
                  return (
                    <div key={b.id} className="rounded-xl border border-white/10 bg-[#111520] p-5 flex flex-col justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs text-blue-400 font-medium">{BOT_TYPE_LABELS[b.bot_type] || b.bot_type}</div>
                            <h3 className="font-display text-base font-bold text-white">{b.name}</h3>
                          </div>
                          <span
                            className={`text-[11px] font-semibold ${
                              b.status === 'ACTIVE'
                                ? 'text-emerald-400'
                                : b.status === 'PAUSED'
                                ? 'text-amber-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {b.status === 'ACTIVE' ? 'ACTIVO' : b.status === 'PAUSED' ? 'PAUSADO' : 'DETENIDO'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{b.description}</p>

                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/8 text-xs font-mono tabular-nums">
                          <div>
                            <div className="text-[10px] text-slate-500 font-sans">Par / Capital</div>
                            <div className="text-white font-semibold">{b.symbol}</div>
                            <div className="text-slate-400">${formatCurrency(b.allocated_usdt, 0)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 font-sans">Simulación ({env})</div>
                            <div className={b.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                              {b.pnl >= 0 ? '+' : ''}
                              {b.pnl.toFixed(2)}
                            </div>
                            <div className="text-slate-400">{b.trades_count} ops</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 font-sans">Aciertos / Hist.</div>
                            <div className="text-slate-100 font-semibold">{winRate}%</div>
                            <div className="text-blue-400">+{b.historical_backtest_pct}% BT</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/8">
                        <button
                          type="button"
                          onClick={() => handleBotStatus(b.id, 'ACTIVE')}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600/20 border border-emerald-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-600/30 cursor-pointer"
                        >
                          <Play className="h-3 w-3" /> Activar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBotStatus(b.id, 'PAUSED')}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-600/20 border border-amber-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-600/30 cursor-pointer"
                        >
                          <Pause className="h-3 w-3" /> Pausar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBotStatus(b.id, 'STOPPED')}
                          className="inline-flex items-center gap-1 rounded-md bg-red-600/20 border border-red-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-600/30 cursor-pointer"
                        >
                          <Square className="h-3 w-3" /> Detener
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfiguringBot(b);
                            setFormName(b.name);
                            setFormSymbol(b.symbol);
                            setFormAlloc(String(b.allocated_usdt));
                            setFormRisk(b.risk_level);
                          }}
                          className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#090B10] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
                        >
                          <Settings2 className="h-3 w-3" /> Configurar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 7 Bot Types Gallery */}
          <div>
            <h2 className="font-display text-base font-semibold text-white mb-3">Galería Completa de Estrategias (7 Tipos)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {templates.map((t) => (
                <div key={t.id} className="rounded-xl border border-white/10 bg-[#111520] p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-blue-400 font-semibold">
                        <Bot className="h-3.5 w-3.5" />
                        {BOT_TYPE_LABELS[t.bot_type] || t.bot_type}
                      </span>
                      <span className="text-slate-400">Riesgo {t.risk_level}</span>
                    </div>
                    <h3 className="font-display text-sm font-bold text-white">{t.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{t.strategy_summary}</p>
                    <div className="text-[11px] font-mono text-slate-400 pt-1">
                      Par sugerido: {t.symbol} · Backtest: +{t.historical_backtest_pct}%
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTryTemplateInDemo(t)}
                    className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer"
                  >
                    PROBAR EN {env}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {configuringBot && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#111520] p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-white">Configurar {formName}</h3>
            <form onSubmit={handleSaveConfig} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Par de Trading</label>
                <select
                  value={formSymbol}
                  onChange={(e) => setFormSymbol(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-sm text-white"
                >
                  {markets.map((m) => (
                    <option key={m.symbol} value={m.symbol}>
                      {m.symbol}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Capital Asignado (USDT)</label>
                <input
                  type="number"
                  min="50"
                  required
                  value={formAlloc}
                  onChange={(e) => setFormAlloc(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-sm text-white"
                />
              </div>
              <div className="text-xs text-slate-400">Nivel de riesgo configurado: {formRisk}</div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfiguringBot(null)}
                  className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
