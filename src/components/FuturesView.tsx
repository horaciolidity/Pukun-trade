import { useEffect, useState } from 'react';
import { AlertTriangle, Calculator } from 'lucide-react';
import { apiFetch, formatCurrency, formatPrice } from '../api';
import { triggerTradeResultFx } from './TradeResultFx';
import { Candle, FuturesPosition, Market, TradingEnv, WalletItem } from '../types';
import { CandlestickChart, ChartPriceLine } from './CandlestickChart';

interface Props {
  env: TradingEnv;
  markets: Market[];
  selectedSymbol: string;
  wallets: WalletItem[];
  positions: FuturesPosition[];
  onChangeSymbol: (symbol: string) => void;
  onUpdated: () => void;
}

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20, 50, 75, 100, 125];

export function FuturesView({ env, markets, selectedSymbol, wallets, positions, onChangeSymbol, onUpdated }: Props) {
  const futuresMarkets = markets.filter((m) => m.futures_enabled === 1);
  const currentMarket = futuresMarkets.find((m) => m.symbol === selectedSymbol) || futuresMarkets[0];

  const [candles, setCandles] = useState<Candle[]>([]);
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [marginMode, setMarginMode] = useState<'ISOLATED' | 'CROSS'>('ISOLATED');
  const [leverage, setLeverage] = useState(10);
  const [marginUsdt, setMarginUsdt] = useState('250');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!currentMarket) return;
    if (leverage > currentMarket.max_leverage) {
      setLeverage(currentMarket.max_leverage);
    }
    const [base, quote] = currentMarket.symbol.split('/');
    let active = true;
    async function load() {
      try {
        const res = await apiFetch<{ candles: Candle[] }>(`/api/markets/${base}/${quote}/chart?tf=5m`);
        if (active) setCandles(res.candles);
      } catch {
        // ignore
      }
    }
    load();
    const t = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [currentMarket?.symbol]);

  const usdtAvailable = wallets.find((w) => w.asset === 'USDT')?.available || 0;
  const numericMargin = parseFloat(marginUsdt) || 0;
  const entryPrice = currentMarket?.last_price || 0;
  const notional = numericMargin * leverage;
  const qty = entryPrice > 0 ? notional / entryPrice : 0;
  const estLiqPrice =
    entryPrice > 0
      ? side === 'LONG'
        ? entryPrice * (1 - 1 / leverage + 0.005)
        : entryPrice * (1 + 1 / leverage - 0.005)
      : 0;

  async function handleOpenPosition(e: React.FormEvent) {
    e.preventDefault();
    if (!currentMarket) return;
    setFeedback(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ entryPrice: number; liqPrice: number }>('/api/futures/open', {
        method: 'POST',
        body: JSON.stringify({
          env,
          symbol: currentMarket.symbol,
          side,
          marginMode,
          leverage,
          marginUsdt: numericMargin,
          stopLoss: parseFloat(stopLoss) || 0,
          takeProfit: parseFloat(takeProfit) || 0,
        }),
      });
      setFeedback({
        type: 'ok',
        text: `Posición ${side} ${leverage}x abierta en ${currentMarket.symbol} @ $${formatPrice(res.entryPrice)} · Liq: $${formatPrice(res.liqPrice)}`,
      });
      onUpdated();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al abrir posición' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClosePosition(id: string) {
    try {
      const res = await apiFetch<{ pnl: number }>(`/api/futures/${id}/close`, { method: 'POST' });
      triggerTradeResultFx(res.pnl, res.pnl >= 0 ? 'FUTUROS 125X · PROFIT' : 'FUTUROS 125X · PÉRDIDA');
      setFeedback({
        type: 'ok',
        text: `Posición cerrada. PnL realizado: ${res.pnl >= 0 ? '+' : ''}${res.pnl.toFixed(2)} USDT`,
      });
      onUpdated();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al cerrar posición' });
    }
  }

  const openPositions = positions.filter((p) => p.status === 'OPEN');
  const closedPositions = positions.filter((p) => p.status !== 'OPEN');

  const futuresChartLines: ChartPriceLine[] = [];
  for (const p of openPositions.filter((pos) => pos.market_symbol === currentMarket?.symbol)) {
    futuresChartLines.push({
      id: `fut_entry_${p.id}`,
      price: p.entry_price,
      color: p.side === 'LONG' ? '#10B981' : '#EF4444',
      title: `${p.side} ${p.leverage}x ENTRY · ${p.qty}`,
      lineStyle: 0,
      lineWidth: 2,
    });
    if (p.liq_price > 0) {
      futuresChartLines.push({
        id: `fut_liq_${p.id}`,
        price: p.liq_price,
        color: '#F59E0B',
        title: `LIQ ${p.side}`,
        lineStyle: 2,
        lineWidth: 1,
      });
    }
    if (p.take_profit > 0) {
      futuresChartLines.push({
        id: `fut_tp_${p.id}`,
        price: p.take_profit,
        color: '#22D3EE',
        title: `TP`,
        lineStyle: 2,
        lineWidth: 1,
      });
    }
    if (p.stop_loss > 0) {
      futuresChartLines.push({
        id: `fut_sl_${p.id}`,
        price: p.stop_loss,
        color: '#F97316',
        title: `SL`,
        lineStyle: 2,
        lineWidth: 1,
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Liquidation Risk Warning */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-xs text-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Advertencia de Riesgo en Futuros:</span> El apalancamiento amplifica tanto las
          ganancias como las pérdidas. Si el precio alcanza tu precio de liquidación, el margen asignado se perderá
          automáticamente. {env === 'REAL' && 'Las operaciones reales requieren habilitación de custodia externa.'}
        </div>
      </div>

      {/* Market Selector & Telemetry */}
      <div className="rounded-xl border border-white/10 bg-[#111520] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={currentMarket?.symbol}
            onChange={(e) => onChangeSymbol(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#090B10] px-3 py-2 text-sm font-semibold text-white"
          >
            {futuresMarkets.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol} Perpetuo (Máx {m.max_leverage}x)
              </option>
            ))}
          </select>

          {currentMarket && (
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <div>
                <div className="text-slate-400">Precio Marca</div>
                <div className="font-mono text-base font-bold text-white tabular-nums">${formatPrice(currentMarket.last_price)}</div>
              </div>
              <div>
                <div className="text-slate-400">Funding Rate (8h)</div>
                <div className="font-mono text-emerald-400 tabular-nums">{(currentMarket.funding_rate * 100).toFixed(4)}%</div>
              </div>
              <div>
                <div className="text-slate-400">Open Interest</div>
                <div className="font-mono text-slate-200 tabular-nums">${formatCurrency(currentMarket.open_interest / 1000000, 1)}M</div>
              </div>
            </div>
          )}
        </div>

        <div className="text-xs font-mono text-slate-300">
          Margen Disponible ({env}): <span className="text-white font-semibold">${formatCurrency(usdtAvailable)} USDT</span>
        </div>
      </div>

      {/* Chart + Futures Ticket */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 rounded-xl border border-white/10 bg-[#111520] p-4">
          <CandlestickChart candles={candles} showEma={true} height={400} priceLines={futuresChartLines} />
        </div>

        <div className="xl:col-span-4 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setSide('LONG')}
              className={`py-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                side === 'LONG' ? 'bg-emerald-600 text-white' : 'bg-[#090B10] text-slate-400'
              }`}
            >
              LONG (Alcista)
            </button>
            <button
              type="button"
              onClick={() => setSide('SHORT')}
              className={`py-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                side === 'SHORT' ? 'bg-red-600 text-white' : 'bg-[#090B10] text-slate-400'
              }`}
            >
              SHORT (Bajista)
            </button>
          </div>

          {/* Margin Mode */}
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMarginMode('ISOLATED')}
              className={`flex-1 py-1.5 rounded border cursor-pointer ${
                marginMode === 'ISOLATED' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-white/10 text-slate-400'
              }`}
            >
              Isolated Margin
            </button>
            <button
              type="button"
              onClick={() => setMarginMode('CROSS')}
              className={`flex-1 py-1.5 rounded border cursor-pointer ${
                marginMode === 'CROSS' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-white/10 text-slate-400'
              }`}
            >
              Cross Margin
            </button>
          </div>

          {/* Leverage Pills */}
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
              <span>Apalancamiento</span>
              <span className="font-mono font-bold text-white">{leverage}x</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {LEVERAGE_OPTIONS.filter((l) => l <= (currentMarket?.max_leverage || 125)).map((lev) => (
                <button
                  key={lev}
                  type="button"
                  onClick={() => setLeverage(lev)}
                  className={`py-1.5 rounded text-xs font-mono cursor-pointer ${
                    leverage === lev ? 'bg-blue-600 text-white font-semibold' : 'bg-[#090B10] text-slate-400 hover:text-white'
                  }`}
                >
                  {lev}x
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleOpenPosition} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Margen Inicial (USDT)</label>
              <input
                type="number"
                step="any"
                min="5"
                required
                value={marginUsdt}
                onChange={(e) => setMarginUsdt(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Take Profit (opcional)</label>
                <input
                  type="number"
                  step="any"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="Precio TP"
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Stop Loss (opcional)</label>
                <input
                  type="number"
                  step="any"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="Precio SL"
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Leverage Calculator */}
            <div className="rounded-lg border border-white/8 bg-[#090B10] p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold pb-1 border-b border-white/6">
                <Calculator className="h-3.5 w-3.5 text-blue-400" />
                <span>Calculadora de Posición</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Tamaño Notional</span>
                <span className="font-mono text-white">${formatCurrency(notional)} USDT</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Cantidad Contrato</span>
                <span className="font-mono text-slate-200">{qty.toFixed(4)} {currentMarket?.base}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Precio Liquidación Est.</span>
                <span className="font-mono text-amber-400 font-semibold">${formatPrice(estLiqPrice)}</span>
              </div>
            </div>

            {feedback && (
              <div
                className={`rounded-lg px-3 py-2 text-xs border ${
                  feedback.type === 'ok'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={`w-full rounded-lg py-2.5 text-sm font-semibold text-white cursor-pointer ${
                side === 'LONG' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              {submitting ? 'Abriendo...' : `Abrir ${side} ${leverage}x (${env})`}
            </button>
          </form>
        </div>
      </div>

      {/* Positions Table */}
      <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Posiciones de Futuros ({openPositions.length} abiertas)</h3>
          <span className="text-xs text-slate-500">Historial: {closedPositions.length}</span>
        </div>
        {positions.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">No hay posiciones de futuros en {env}.</div>
        ) : (
          <table className="w-full text-left text-xs min-w-195">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-2.5 px-4">Contrato</th>
                <th className="py-2.5 px-4">Dirección</th>
                <th className="py-2.5 px-4 text-right">Margen</th>
                <th className="py-2.5 px-4 text-right">Entrada</th>
                <th className="py-2.5 px-4 text-right">Liquidación</th>
                <th className="py-2.5 px-4 text-right">PnL Tiempo Real</th>
                <th className="py-2.5 px-4">Estado</th>
                <th className="py-2.5 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono tabular-nums">
              {positions.map((p) => {
                const mk = markets.find((m) => m.symbol === p.market_symbol);
                const livePnl =
                  p.status === 'OPEN' && mk
                    ? p.side === 'LONG'
                      ? (mk.last_price - p.entry_price) * p.qty
                      : (p.entry_price - mk.last_price) * p.qty
                    : p.realized_pnl;

                return (
                  <tr key={p.id} className="hover:bg-white/2">
                    <td className="py-2.5 px-4 font-sans font-semibold text-white">
                      {p.market_symbol} <span className="text-slate-500 font-normal">({p.margin_mode})</span>
                    </td>
                    <td className="py-2.5 px-4 font-sans">
                      <span className={p.side === 'LONG' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                        {p.side} {p.leverage}x
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-200">${p.margin.toFixed(2)}</td>
                    <td className="py-2.5 px-4 text-right text-slate-200">${formatPrice(p.entry_price)}</td>
                    <td className="py-2.5 px-4 text-right text-amber-400">${formatPrice(p.liq_price)}</td>
                    <td className={`py-2.5 px-4 text-right font-semibold ${livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {livePnl >= 0 ? '+' : ''}
                      {livePnl.toFixed(2)} USDT
                    </td>
                    <td className="py-2.5 px-4 font-sans text-slate-300">{p.status}</td>
                    <td className="py-2.5 px-4 text-right font-sans">
                      {p.status === 'OPEN' ? (
                        <button
                          type="button"
                          onClick={() => handleClosePosition(p.id)}
                          className="rounded bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 cursor-pointer"
                        >
                          Cerrar
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
