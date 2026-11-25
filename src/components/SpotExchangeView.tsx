import { useEffect, useState } from 'react';
import { apiFetch, formatCurrency, formatPrice } from '../api';
import {
  Candle,
  ExperienceLevel,
  Market,
  OrderBook,
  SpotOrder,
  TechnicalIndicators,
  TradingEnv,
  WalletItem,
} from '../types';
import { CandlestickChart, ChartPriceLine } from './CandlestickChart';

interface Props {
  env: TradingEnv;
  experience: ExperienceLevel;
  markets: Market[];
  selectedSymbol: string;
  presetSide?: 'BUY' | 'SELL';
  wallets: WalletItem[];
  orders: SpotOrder[];
  onChangeSymbol: (symbol: string) => void;
  onOrderCompleted: () => void;
}

export function SpotExchangeView({
  env,
  experience,
  markets,
  selectedSymbol,
  presetSide,
  wallets,
  orders,
  onChangeSymbol,
  onOrderCompleted,
}: Props) {
  const [terminalMode, setTerminalMode] = useState<'SIMPLE' | 'PRO'>(experience === 'BEGINNER' ? 'SIMPLE' : 'PRO');
  const [timeframe, setTimeframe] = useState('1m');
  const [showEma, setShowEma] = useState(true);
  const [showBb, setShowBb] = useState(false);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);

  const [side, setSide] = useState<'BUY' | 'SELL'>(presetSide || 'BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'OCO'>('MARKET');
  const [qty, setQty] = useState('0.01');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const spotMarkets = markets.filter((m) => m.spot_enabled === 1);
  const currentMarket = spotMarkets.find((m) => m.symbol === selectedSymbol) || spotMarkets[0];
  const [base, quote] = (currentMarket?.symbol || 'BTC/USDT').split('/');

  useEffect(() => {
    if (presetSide) setSide(presetSide);
  }, [presetSide]);

  useEffect(() => {
    if (!currentMarket) return;
    let active = true;
    async function loadChart() {
      try {
        const res = await apiFetch<{
          candles: Candle[];
          indicators: TechnicalIndicators;
          orderBook: OrderBook;
        }>(`/api/markets/${base}/${quote}/chart?tf=${timeframe}`);
        if (!active) return;
        setCandles(res.candles);
        setIndicators(res.indicators);
        setOrderBook(res.orderBook);
        if (!limitPrice) {
          setLimitPrice(String(currentMarket.last_price));
        }
      } catch {
        // silent retry on next poll
      }
    }
    loadChart();
    const timer = setInterval(loadChart, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [currentMarket?.symbol, timeframe, base, quote]);

  const quoteBalance = wallets.find((w) => w.asset === quote)?.available || 0;
  const baseBalance = wallets.find((w) => w.asset === base)?.available || 0;
  const effectivePrice =
    orderType === 'MARKET' ? currentMarket?.last_price || 0 : parseFloat(limitPrice) || currentMarket?.last_price || 0;
  const numericQty = parseFloat(qty) || 0;
  const estimatedTotal = numericQty * effectivePrice;
  const feeBps = orderType === 'MARKET' ? currentMarket?.taker_fee_bps || 10 : currentMarket?.maker_fee_bps || 10;
  const estimatedFee = (estimatedTotal * feeBps) / 10000;

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!currentMarket) return;
    setFeedback(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ executedPrice: number; fee: number }>('/api/spot/order', {
        method: 'POST',
        body: JSON.stringify({
          env,
          symbol: currentMarket.symbol,
          side,
          type: terminalMode === 'SIMPLE' ? 'MARKET' : orderType,
          qty: numericQty,
          price: parseFloat(limitPrice) || currentMarket.last_price,
          stopPrice: parseFloat(stopPrice) || 0,
        }),
      });
      setFeedback({
        type: 'ok',
        text: `Orden ${side === 'BUY' ? 'Compra' : 'Venta'} registrada (${env}) @ $${formatPrice(res.executedPrice)} · Comisión: $${res.fee.toFixed(4)}`,
      });
      onOrderCompleted();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al enviar orden' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    try {
      await apiFetch(`/api/spot/orders/${orderId}`, { method: 'DELETE' });
      onOrderCompleted();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'No se pudo cancelar la orden' });
    }
  }

  function applyPercent(pct: number) {
    if (!currentMarket || effectivePrice <= 0) return;
    if (side === 'BUY') {
      const maxUsdt = quoteBalance * (pct / 100) * 0.998;
      setQty((maxUsdt / effectivePrice).toFixed(currentMarket.qty_precision));
    } else {
      setQty((baseBalance * (pct / 100)).toFixed(currentMarket.qty_precision));
    }
  }

  const symbolOpenOrders = orders.filter(
    (o) => o.status === 'OPEN' && o.market_symbol === currentMarket?.symbol
  );

  const chartPriceLines: ChartPriceLine[] = [];

  // 1. Open Spot Orders (Limit, Stop Limit, Stop Loss, Take Profit, OCO)
  for (const ord of symbolOpenOrders) {
    const isBuy = ord.side === 'BUY';
    if (ord.price > 0) {
      chartPriceLines.push({
        id: `ord_${ord.id}`,
        price: ord.price,
        color: isBuy ? '#10B981' : '#EF4444',
        title: `${ord.side} ${ord.type} · ${ord.qty} ${base}`,
        lineStyle: 0,
        lineWidth: 2,
      });
    }
    if (ord.stop_price > 0) {
      chartPriceLines.push({
        id: `stop_${ord.id}`,
        price: ord.stop_price,
        color: '#F59E0B',
        title: `STOP TRIGGER (${ord.side}) · ${ord.qty} ${base}`,
        lineStyle: 2,
        lineWidth: 2,
      });
    }
  }

  // 2. Average Spot Entry Position from filled BUY orders on this pair
  const filledBuys = orders.filter(
    (o) => o.status === 'FILLED' && o.side === 'BUY' && o.market_symbol === currentMarket?.symbol && o.price > 0
  );
  if (filledBuys.length > 0 && baseBalance > 0) {
    const totalQty = filledBuys.reduce((acc, o) => acc + o.qty, 0);
    const avgEntry =
      totalQty > 0 ? filledBuys.reduce((acc, o) => acc + o.price * o.qty, 0) / totalQty : 0;
    if (avgEntry > 0) {
      chartPriceLines.push({
        id: `pos_avg_${currentMarket?.symbol}`,
        price: Number(avgEntry.toFixed(currentMarket?.price_precision ?? 2)),
        color: '#22D3EE',
        title: `POSICIÓN SPOT · ${baseBalance.toFixed(4)} ${base}`,
        lineStyle: 1,
        lineWidth: 1,
      });
    }
  }

  // 3. Live Preview lines while typing Limit / Stop Price before submitting
  if (terminalMode === 'PRO' && orderType !== 'MARKET') {
    const lpNum = Number(limitPrice);
    if (Number.isFinite(lpNum) && lpNum > 0) {
      chartPriceLines.push({
        id: 'preview_limit',
        price: lpNum,
        color: side === 'BUY' ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)',
        title: `PREVIEW ${side} ${orderType}`,
        lineStyle: 3,
        lineWidth: 1,
      });
    }
    const spNum = Number(stopPrice);
    if (Number.isFinite(spNum) && spNum > 0) {
      chartPriceLines.push({
        id: 'preview_stop',
        price: spNum,
        color: 'rgba(245, 158, 11, 0.85)',
        title: `PREVIEW STOP TRIGGER`,
        lineStyle: 3,
        lineWidth: 1,
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="rounded-xl border border-white/10 bg-[#111520] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={currentMarket?.symbol}
            onChange={(e) => {
              onChangeSymbol(e.target.value);
              setLimitPrice('');
            }}
            className="rounded-lg border border-white/15 bg-[#090B10] px-3 py-2 text-sm font-semibold text-white focus:border-blue-500 focus:outline-none"
          >
            {spotMarkets.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol}
              </option>
            ))}
          </select>

          {currentMarket && (
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <div>
                <div className="text-slate-400">Precio Actual</div>
                <div className={`font-mono text-base font-bold tabular-nums ${currentMarket.change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${formatPrice(currentMarket.last_price)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">24h</div>
                <div className={`font-mono font-semibold tabular-nums ${currentMarket.change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentMarket.change_24h >= 0 ? '+' : ''}
                  {currentMarket.change_24h.toFixed(2)}%
                </div>
              </div>
              <div className="hidden sm:block">
                <div className="text-slate-400">Spread / Comisión</div>
                <div className="font-mono text-slate-200 tabular-nums">
                  {orderBook?.spreadPct ?? 0.04}% · {(feeBps / 100).toFixed(2)}%
                </div>
              </div>
              <div className="hidden md:block">
                <div className="text-slate-400">Volumen 24h</div>
                <div className="font-mono text-slate-200 tabular-nums">${formatCurrency(currentMarket.volume_24h / 1000000, 2)}M</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090B10] border border-white/10">
          <button
            type="button"
            onClick={() => setTerminalMode('SIMPLE')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${terminalMode === 'SIMPLE' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
          >
            Modo Sencillo
          </button>
          <button
            type="button"
            onClick={() => setTerminalMode('PRO')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${terminalMode === 'PRO' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
          >
            Modo Profesional
          </button>
        </div>
      </div>

      {terminalMode === 'SIMPLE' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 rounded-xl border border-white/10 bg-[#111520] p-6">
            <h2 className="font-display text-lg font-bold text-white">Compra y Venta Rápida ({env})</h2>
            <p className="text-xs text-slate-400 mt-1 mb-5">
              1. Elige criptomoneda · 2. Selecciona Comprar o Vender · 3. Indica cantidad · 4. Confirma.
            </p>

            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide('BUY')}
                  className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer ${side === 'BUY'
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-[#090B10] border-white/10 text-slate-400 hover:text-white'
                    }`}
                >
                  Comprar {base}
                </button>
                <button
                  type="button"
                  onClick={() => setSide('SELL')}
                  className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer ${side === 'SELL'
                      ? 'bg-red-600 border-red-500 text-white'
                      : 'bg-[#090B10] border-white/10 text-slate-400 hover:text-white'
                    }`}
                >
                  Vender {base}
                </button>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                  <span>Cantidad ({base})</span>
                  <span className="font-mono">
                    Disponible: {side === 'BUY' ? `${formatCurrency(quoteBalance)} ${quote}` : `${baseBalance.toFixed(4)} ${base}`}
                  </span>
                </div>
                <input
                  type="number"
                  step="any"
                  min={currentMarket?.min_qty || 0.0001}
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 font-mono text-sm text-white focus:border-blue-500 focus:outline-none"
                />
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyPercent(pct)}
                      className="rounded-md border border-white/10 bg-[#090B10] py-1 text-xs font-mono text-slate-300 hover:bg-white/5 cursor-pointer"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/8 bg-[#090B10] p-3 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-400">
                  <span>Total estimado</span>
                  <span className="font-mono text-white">${formatCurrency(estimatedTotal)} {quote}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Comisión estimada ({(feeBps / 100).toFixed(2)}%)</span>
                  <span className="font-mono text-slate-300">${estimatedFee.toFixed(4)} {quote}</span>
                </div>
              </div>

              {feedback && (
                <div
                  className={`rounded-lg px-3.5 py-2.5 text-xs border ${feedback.type === 'ok'
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
                className={`w-full rounded-lg py-3 text-sm font-semibold text-white transition-colors cursor-pointer ${side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                  }`}
              >
                {submitting ? 'Ejecutando...' : `Confirmar ${side === 'BUY' ? 'Compra' : 'Venta'} en ${env}`}
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 rounded-xl border border-white/10 bg-[#111520] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Gráfico de Precio — {currentMarket?.symbol}</span>
              <div className="flex items-center gap-1">
                {['1m', '5m', '15m', '1h'].map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer ${timeframe === tf ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <CandlestickChart candles={candles} showEma={true} height={360} priceLines={chartPriceLines} />
          </div>
        </div>
      ) : (
        /* PRO TERMINAL */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Chart + Indicators */}
          <div className="xl:col-span-6 rounded-xl border border-white/10 bg-[#111520] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer ${timeframe === tf ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowEma(!showEma)}
                  className={`px-2.5 py-1 rounded border cursor-pointer ${showEma ? 'border-blue-500/40 bg-blue-500/15 text-blue-300' : 'border-white/10 text-slate-400'
                    }`}
                >
                  EMA 9/21
                </button>
                <button
                  type="button"
                  onClick={() => setShowBb(!showBb)}
                  className={`px-2.5 py-1 rounded border cursor-pointer ${showBb ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-white/10 text-slate-400'
                    }`}
                >
                  Bollinger
                </button>
              </div>
            </div>

            <CandlestickChart
              candles={candles}
              showEma={showEma}
              showBollinger={showBb}
              height={370}
              priceLines={chartPriceLines}
            />

            {symbolOpenOrders.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
                  En gráfico ({symbolOpenOrders.length}):
                </span>
                {symbolOpenOrders.map((ord) => (
                  <span
                    key={ord.id}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-mono ${ord.side === 'BUY'
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                        : 'border-red-500/35 bg-red-500/10 text-red-300'
                      }`}
                  >
                    <span>
                      {ord.side} {ord.type} {ord.qty} {base} @ ${formatPrice(ord.price)}
                      {ord.stop_price > 0 ? ` (Stop $${formatPrice(ord.stop_price)})` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCancelOrder(ord.id)}
                      className="text-slate-300 hover:text-white font-bold cursor-pointer"
                      title="Cancelar orden"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {indicators && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs font-mono tabular-nums">
                <div className="rounded-lg bg-[#090B10] px-3 py-2 border border-white/6">
                  <div className="text-[11px] text-slate-500">RSI (14)</div>
                  <div className="text-slate-100 font-semibold">{indicators.rsi14}</div>
                </div>
                <div className="rounded-lg bg-[#090B10] px-3 py-2 border border-white/6">
                  <div className="text-[11px] text-slate-500">MACD</div>
                  <div className={indicators.macd >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {indicators.macd}
                  </div>
                </div>
                <div className="rounded-lg bg-[#090B10] px-3 py-2 border border-white/6">
                  <div className="text-[11px] text-slate-500">Soporte</div>
                  <div className="text-slate-100 font-semibold">${formatPrice(indicators.support)}</div>
                </div>
                <div className="rounded-lg bg-[#090B10] px-3 py-2 border border-white/6">
                  <div className="text-[11px] text-slate-500">Resistencia</div>
                  <div className="text-slate-100 font-semibold">${formatPrice(indicators.resistance)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Order Book */}
          <div className="xl:col-span-3 rounded-xl border border-white/10 bg-[#111520] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-white">Libro de Órdenes</h3>
              <span className="text-[11px] font-mono text-slate-400">Spread {orderBook?.spreadPct ?? 0.04}%</span>
            </div>
            <div className="grid grid-cols-3 text-[11px] text-slate-500 pb-1.5 border-b border-white/8">
              <span>Precio ({quote})</span>
              <span className="text-right">Cant. ({base})</span>
              <span className="text-right">Acum.</span>
            </div>

            <div className="flex-1 space-y-0.5 py-1.5 font-mono text-[11px] tabular-nums">
              {orderBook?.asks.slice(-8).map((a, idx) => (
                <button
                  key={`ask-${idx}`}
                  type="button"
                  onClick={() => setLimitPrice(String(a.price))}
                  className="w-full grid grid-cols-3 py-0.5 hover:bg-red-500/10 cursor-pointer text-left"
                >
                  <span className="text-red-400">{formatPrice(a.price)}</span>
                  <span className="text-right text-slate-300">{a.qty.toFixed(3)}</span>
                  <span className="text-right text-slate-500">{a.total.toFixed(2)}</span>
                </button>
              ))}

              <div className="py-1.5 my-1 border-y border-white/8 text-center font-semibold text-sm text-white">
                ${formatPrice(currentMarket?.last_price || 0)}
              </div>

              {orderBook?.bids.slice(0, 8).map((b, idx) => (
                <button
                  key={`bid-${idx}`}
                  type="button"
                  onClick={() => setLimitPrice(String(b.price))}
                  className="w-full grid grid-cols-3 py-0.5 hover:bg-emerald-500/10 cursor-pointer text-left"
                >
                  <span className="text-emerald-400">{formatPrice(b.price)}</span>
                  <span className="text-right text-slate-300">{b.qty.toFixed(3)}</span>
                  <span className="text-right text-slate-500">{b.total.toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pro Order Entry */}
          <div className="xl:col-span-3 rounded-xl border border-white/10 bg-[#111520] p-4">
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => setSide('BUY')}
                className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${side === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-[#090B10] text-slate-400'
                  }`}
              >
                Comprar
              </button>
              <button
                type="button"
                onClick={() => setSide('SELL')}
                className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${side === 'SELL' ? 'bg-red-600 text-white' : 'bg-[#090B10] text-slate-400'
                  }`}
              >
                Vender
              </button>
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {(['MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT', 'OCO'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOrderType(t)}
                  className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${orderType === t ? 'bg-blue-600 text-white' : 'bg-[#090B10] text-slate-400 hover:text-white'
                    }`}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmitOrder} className="space-y-3">
              {orderType !== 'MARKET' && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Precio Límite ({quote})</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {(orderType === 'STOP_LOSS' || orderType === 'OCO') && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Precio Stop ({quote})</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Cantidad ({base})</span>
                  <span className="font-mono">
                    {side === 'BUY' ? `${formatCurrency(quoteBalance)} ${quote}` : `${baseBalance.toFixed(4)} ${base}`}
                  </span>
                </div>
                <input
                  type="number"
                  step="any"
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
                />
                <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyPercent(pct)}
                      className="rounded border border-white/10 bg-[#090B10] py-1 text-[11px] font-mono text-slate-300 hover:bg-white/5 cursor-pointer"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg bg-[#090B10] border border-white/8 p-2.5 text-[11px] space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Total</span>
                  <span className="font-mono text-white">${formatCurrency(estimatedTotal)} {quote}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Comisión ({(feeBps / 100).toFixed(2)}%)</span>
                  <span className="font-mono text-slate-300">${estimatedFee.toFixed(4)}</span>
                </div>
              </div>

              {feedback && (
                <div
                  className={`rounded-lg px-3 py-2 text-[11px] border ${feedback.type === 'ok'
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
                className={`w-full rounded-lg py-2.5 text-xs font-semibold text-white cursor-pointer ${side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                  }`}
              >
                {submitting ? 'Procesando...' : `${side === 'BUY' ? 'Comprar' : 'Vender'} ${base} (${env})`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Orders History Table */}
      <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Órdenes Spot e Historial ({env})</h3>
          <span className="text-xs text-slate-500">{orders.length} registros</span>
        </div>
        {orders.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">Aún no hay órdenes Spot registradas en {env}.</div>
        ) : (
          <table className="w-full text-left text-xs min-w-[680px]">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-2.5 px-4">Par</th>
                <th className="py-2.5 px-4">Tipo / Lado</th>
                <th className="py-2.5 px-4 text-right">Precio</th>
                <th className="py-2.5 px-4 text-right">Cantidad</th>
                <th className="py-2.5 px-4 text-right">Comisión</th>
                <th className="py-2.5 px-4">Estado</th>
                <th className="py-2.5 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono tabular-nums">
              {orders.slice(0, 15).map((o) => (
                <tr key={o.id} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 px-4 font-sans font-semibold text-white">{o.market_symbol}</td>
                  <td className="py-2.5 px-4 font-sans">
                    <span className={o.side === 'BUY' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {o.side}
                    </span>{' '}
                    <span className="text-slate-400">{o.type}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-200">${formatPrice(o.price)}</td>
                  <td className="py-2.5 px-4 text-right text-slate-200">{o.qty}</td>
                  <td className="py-2.5 px-4 text-right text-slate-400">${o.fee.toFixed(4)}</td>
                  <td className="py-2.5 px-4 font-sans">
                    <span
                      className={
                        o.status === 'FILLED'
                          ? 'text-emerald-400'
                          : o.status === 'OPEN'
                            ? 'text-blue-400'
                            : 'text-slate-500'
                      }
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-sans">
                    {o.status === 'OPEN' ? (
                      <button
                        type="button"
                        onClick={() => handleCancelOrder(o.id)}
                        className="text-red-400 hover:underline cursor-pointer"
                      >
                        Cancelar
                      </button>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
