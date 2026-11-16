import crypto from 'crypto';
import { db } from './db.ts';
import { createNotification } from './auth.ts';
import { computeQuickTradeLiveMetrics, computeQuickTradeSettlement } from '../src/utils/quickTradeMath.ts';

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketRow {
  symbol: string;
  base: string;
  quote: string;
  base_price: number;
  last_price: number;
  high_24h: number;
  low_24h: number;
  change_24h: number;
  volume_24h: number;
  spread_bps: number;
  maker_fee_bps: number;
  taker_fee_bps: number;
  min_qty: number;
  price_precision: number;
  qty_precision: number;
  spot_enabled: number;
  futures_enabled: number;
  max_leverage: number;
  funding_rate: number;
  open_interest: number;
  is_custom_token: number;
  liquidity_usdt: number;
  price_source: string;
  active: number;
}

export interface TechnicalIndicators {
  symbol: string;
  lastPrice: number;
  rsi14: number;
  ema9: number;
  ema21: number;
  sma20: number;
  macd: number;
  macdSignal: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr14: number;
  support: number;
  resistance: number;
  volatilityPct: number;
  trendBias: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
}

type BroadcastHandler = (event: string, payload: unknown, targetUserId?: string) => void;

const candleStore = new Map<string, Candle[]>();
let broadcast: BroadcastHandler = () => {};
let tickInterval: NodeJS.Timeout | null = null;
let binanceSyncInterval: NodeJS.Timeout | null = null;
let botTickCounter = 0;

export function setBroadcastHandler(fn: BroadcastHandler) {
  broadcast = fn;
}

function seedCandlesForSymbol(symbol: string, anchorPrice: number) {
  const candles: Candle[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const alignedNow = nowSec - (nowSec % 60);
  let price = anchorPrice * (0.965 + Math.random() * 0.03);

  for (let i = 180; i >= 0; i--) {
    const t = alignedNow - i * 60;
    const drift = (anchorPrice - price) * 0.04;
    const shock = price * (Math.random() - 0.495) * 0.0045;
    const open = price;
    const close = Math.max(anchorPrice * 0.5, open + drift + shock);
    const wickHigh = Math.max(open, close) * (1 + Math.random() * 0.0022);
    const wickLow = Math.min(open, close) * (1 - Math.random() * 0.0022);
    const vol = (anchorPrice > 1000 ? 12 : 1200) * (0.6 + Math.random() * 1.4);
    candles.push({
      time: t,
      open: Number(open.toFixed(6)),
      high: Number(wickHigh.toFixed(6)),
      low: Number(wickLow.toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: Number(vol.toFixed(2)),
    });
    price = close;
  }
  candleStore.set(symbol, candles);
}

export function ensureCandlesExist(symbol: string, currentPrice: number) {
  if (!candleStore.has(symbol)) {
    seedCandlesForSymbol(symbol, currentPrice);
  }
}

export function getCandles(symbol: string, timeframe = '1m'): Candle[] {
  const market = db.prepare(`SELECT last_price FROM markets WHERE symbol = ?`).get(symbol) as { last_price: number } | undefined;
  const price = market?.last_price || 100;
  ensureCandlesExist(symbol, price);
  const base = candleStore.get(symbol) || [];

  const tfMinutes: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };
  const stepMin = tfMinutes[timeframe] || 1;
  if (stepMin === 1) return base;

  const grouped: Candle[] = [];
  const stepSec = stepMin * 60;
  for (const c of base) {
    const bucket = c.time - (c.time % stepSec);
    const last = grouped[grouped.length - 1];
    if (!last || last.time !== bucket) {
      grouped.push({ ...c, time: bucket });
    } else {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume = Number((last.volume + c.volume).toFixed(2));
    }
  }
  return grouped;
}

function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

export function computeTechnicalIndicators(symbol: string): TechnicalIndicators {
  const candles = getCandles(symbol, '1m');
  const closes = candles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1] || 0;

  // RSI-14
  let gains = 0;
  let losses = 0;
  const rsiSlice = closes.slice(-15);
  for (let i = 1; i < rsiSlice.length; i++) {
    const diff = rsiSlice[i] - rsiSlice[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14 || 0.000001;
  const rs = avgGain / avgLoss;
  const rsi14 = Number((100 - 100 / (1 + rs)).toFixed(2));

  const ema9 = Number(calcEMA(closes.slice(-30), 9).toFixed(6));
  const ema21 = Number(calcEMA(closes.slice(-50), 21).toFixed(6));
  const ema12 = calcEMA(closes.slice(-40), 12);
  const ema26 = calcEMA(closes.slice(-60), 26);
  const macd = Number((ema12 - ema26).toFixed(6));
  const macdSignal = Number((macd * 0.82).toFixed(6));

  const last20 = closes.slice(-20);
  const sma20 = last20.reduce((a, b) => a + b, 0) / Math.max(1, last20.length);
  const variance = last20.reduce((sum, v) => sum + Math.pow(v - sma20, 2), 0) / Math.max(1, last20.length);
  const stdDev = Math.sqrt(variance);

  const bbUpper = Number((sma20 + 2 * stdDev).toFixed(6));
  const bbLower = Number((sma20 - 2 * stdDev).toFixed(6));

  const recentCandles = candles.slice(-14);
  const atr14 = Number(
    (
      recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) /
      Math.max(1, recentCandles.length)
    ).toFixed(6)
  );

  const last60 = candles.slice(-60);
  const support = Number(Math.min(...last60.map((c) => c.low)).toFixed(6));
  const resistance = Number(Math.max(...last60.map((c) => c.high)).toFixed(6));
  const volatilityPct = Number(((stdDev / Math.max(0.000001, sma20)) * 100).toFixed(2));

  let trendBias: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
  if (ema9 > ema21 && rsi14 > 52) trendBias = 'BULLISH';
  else if (ema9 < ema21 && rsi14 < 48) trendBias = 'BEARISH';

  return {
    symbol,
    lastPrice,
    rsi14,
    ema9,
    ema21,
    sma20: Number(sma20.toFixed(6)),
    macd,
    macdSignal,
    bbUpper,
    bbMiddle: Number(sma20.toFixed(6)),
    bbLower,
    atr14,
    support,
    resistance,
    volatilityPct,
    trendBias,
  };
}

export function buildOrderBook(symbol: string, lastPrice: number, spreadBps = 4) {
  const halfSpread = (lastPrice * spreadBps) / 20000;
  const bids: { price: number; qty: number; total: number }[] = [];
  const asks: { price: number; qty: number; total: number }[] = [];

  let cumBid = 0;
  let cumAsk = 0;
  for (let i = 0; i < 12; i++) {
    const step = lastPrice * (0.00035 * (i + 1));
    const bidPrice = Number((lastPrice - halfSpread - step).toFixed(lastPrice < 5 ? 4 : 2));
    const askPrice = Number((lastPrice + halfSpread + step).toFixed(lastPrice < 5 ? 4 : 2));
    const bidQty = Number((((i + 1) * 0.4 + Math.random() * 1.2) * (1000 / Math.max(1, lastPrice))).toFixed(4));
    const askQty = Number((((i + 1) * 0.4 + Math.random() * 1.2) * (1000 / Math.max(1, lastPrice))).toFixed(4));
    cumBid = Number((cumBid + bidQty).toFixed(4));
    cumAsk = Number((cumAsk + askQty).toFixed(4));
    bids.push({ price: bidPrice, qty: bidQty, total: cumBid });
    asks.push({ price: askPrice, qty: askQty, total: cumAsk });
  }

  return {
    symbol,
    lastPrice,
    spreadPct: Number(((halfSpread * 2 / Math.max(0.0001, lastPrice)) * 100).toFixed(4)),
    bids,
    asks: asks.reverse(),
  };
}

async function syncBinancePublicPrices() {
  try {
    const qtCfgRow = db.prepare(`SELECT value_json FROM system_config WHERE key = 'quick_trading'`).get() as
      | { value_json: string }
      | undefined;
    const qtCfg = qtCfgRow ? (JSON.parse(qtCfgRow.value_json) as { priceProvider?: string }) : {};
    if (qtCfg.priceProvider === 'SIMULATED_FEED') {
      db.prepare(`UPDATE markets SET price_source = 'SIMULATED_FEED' WHERE is_custom_token = 0`).run();
      return;
    }

    const symbolsMap: Record<string, string> = {
      BTCUSDT: 'BTC/USDT',
      ETHUSDT: 'ETH/USDT',
      SOLUSDT: 'SOL/USDT',
      XRPUSDT: 'XRP/USDT',
      BNBUSDT: 'BNB/USDT',
      ADAUSDT: 'ADA/USDT',
      DOGEUSDT: 'DOGE/USDT',
    };
    const param = encodeURIComponent(JSON.stringify(Object.keys(symbolsMap)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${param}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      highPrice: string;
      lowPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
    }>;

    const updateStmt = db.prepare(`
      UPDATE markets
      SET last_price = ?, high_24h = ?, low_24h = ?, change_24h = ?, volume_24h = ?, price_source = 'BINANCE_PUBLIC'
      WHERE symbol = ?
    `);

    const syncedUpdates: Array<{
      symbol: string;
      last_price: number;
      change_24h: number;
      high_24h: number;
      low_24h: number;
      price_source: string;
    }> = [];

    for (const r of rows) {
      const localSym = symbolsMap[r.symbol];
      if (!localSym) continue;
      const last = parseFloat(r.lastPrice);
      const high = parseFloat(r.highPrice);
      const low = parseFloat(r.lowPrice);
      const chg = parseFloat(r.priceChangePercent);
      const vol = parseFloat(r.quoteVolume);
      if (Number.isFinite(last) && last > 0) {
        updateStmt.run(last, high, low, chg, vol, localSym);
        syncedUpdates.push({
          symbol: localSym,
          last_price: last,
          change_24h: chg,
          high_24h: high,
          low_24h: low,
          price_source: 'BINANCE_PUBLIC',
        });
        ensureCandlesExist(localSym, last);
        const list = candleStore.get(localSym)!;
        if (list.length > 0) {
          const tail = list[list.length - 1];
          tail.close = last;
          tail.high = Math.max(tail.high, last);
          tail.low = Math.min(tail.low, last);
        }
      }
    }

    if (syncedUpdates.length > 0) {
      broadcast('market:ticks', syncedUpdates);
      const allMarketPrices = db.prepare(`SELECT symbol, last_price FROM markets WHERE active = 1`).all() as Array<{
        symbol: string;
        last_price: number;
      }>;
      processActiveQuickTrades(allMarketPrices);
    }
  } catch {
    // Graceful fallback to internal price feed if external API is blocked/rate-limited
  }
}

function updateMarketsTick() {
  const markets = db.prepare(`SELECT * FROM markets WHERE active = 1`).all() as MarketRow[];
  const nowSec = Math.floor(Date.now() / 1000);
  const minuteBucket = nowSec - (nowSec % 60);
  const updates: Array<{ symbol: string; last_price: number; change_24h: number; high_24h: number; low_24h: number; price_source: string }> = [];

  const updStmt = db.prepare(`
    UPDATE markets SET last_price = ?, high_24h = ?, low_24h = ?, change_24h = ?, volume_24h = ? WHERE symbol = ?
  `);

  for (const m of markets) {
    ensureCandlesExist(m.symbol, m.last_price);
    const volatility = m.is_custom_token ? 0.0028 : 0.0014;
    const pctDelta = (Math.random() - 0.496) * volatility;
    const rawNew = Math.max(0.0001, m.last_price * (1 + pctDelta));
    const newPrice = Number(rawNew.toFixed(m.price_precision));
    const newHigh = Math.max(m.high_24h, newPrice);
    const newLow = Math.min(m.low_24h, newPrice);
    const newChange = Number((((newPrice - m.base_price) / m.base_price) * 100).toFixed(2));
    const newVol = Number((m.volume_24h + newPrice * (Math.random() * 12)).toFixed(0));

    updStmt.run(newPrice, newHigh, newLow, newChange, newVol, m.symbol);
    updates.push({
      symbol: m.symbol,
      last_price: newPrice,
      change_24h: newChange,
      high_24h: newHigh,
      low_24h: newLow,
      price_source: m.price_source,
    });

    const candles = candleStore.get(m.symbol)!;
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle || lastCandle.time < minuteBucket) {
      candles.push({
        time: minuteBucket,
        open: m.last_price,
        high: Math.max(m.last_price, newPrice),
        low: Math.min(m.last_price, newPrice),
        close: newPrice,
        volume: Number((Math.random() * 50 + 5).toFixed(2)),
      });
      if (candles.length > 300) candles.shift();
    } else {
      lastCandle.close = newPrice;
      lastCandle.high = Math.max(lastCandle.high, newPrice);
      lastCandle.low = Math.min(lastCandle.low, newPrice);
      lastCandle.volume = Number((lastCandle.volume + Math.random() * 4).toFixed(2));
    }
  }

  broadcast('market:ticks', updates);

  // Match pending spot orders, futures SL/TP/liquidation, quick trades, and bots
  processPendingSpotOrders(updates);
  processOpenFuturesPositions(updates);
  processActiveQuickTrades(updates);

  botTickCounter++;
  if (botTickCounter % 3 === 0) {
    processActiveBots(updates);
  }
}

function processPendingSpotOrders(updates: Array<{ symbol: string; last_price: number }>) {
  const priceMap = new Map(updates.map((u) => [u.symbol, u.last_price]));
  const openOrders = db.prepare(`SELECT * FROM orders WHERE status = 'OPEN'`).all() as Array<{
    id: string;
    user_id: string;
    env: 'DEMO' | 'REAL';
    market_symbol: string;
    side: 'BUY' | 'SELL';
    type: string;
    price: number;
    stop_price: number;
    qty: number;
    fee: number;
  }>;

  for (const ord of openOrders) {
    const marketPrice = priceMap.get(ord.market_symbol);
    if (!marketPrice) continue;

    let shouldFill = false;
    if (ord.type === 'LIMIT') {
      if (ord.side === 'BUY' && marketPrice <= ord.price) shouldFill = true;
      if (ord.side === 'SELL' && marketPrice >= ord.price) shouldFill = true;
    } else if (ord.type === 'STOP_LOSS') {
      if (ord.side === 'SELL' && marketPrice <= ord.stop_price) shouldFill = true;
      if (ord.side === 'BUY' && marketPrice >= ord.stop_price) shouldFill = true;
    } else if (ord.type === 'TAKE_PROFIT' || ord.type === 'OCO') {
      if (ord.side === 'SELL' && (marketPrice >= ord.price || (ord.stop_price > 0 && marketPrice <= ord.stop_price))) {
        shouldFill = true;
      }
      if (ord.side === 'BUY' && (marketPrice <= ord.price || (ord.stop_price > 0 && marketPrice >= ord.stop_price))) {
        shouldFill = true;
      }
    }

    if (!shouldFill) continue;

    const [base, quote] = ord.market_symbol.split('/');
    const execPrice = marketPrice;
    const totalQuote = execPrice * ord.qty;
    const fee = Number((totalQuote * 0.001).toFixed(4));

    const tx = db.transaction(() => {
      db.prepare(`UPDATE orders SET status = 'FILLED', filled_qty = qty, price = ?, fee = ? WHERE id = ?`).run(
        execPrice,
        fee,
        ord.id
      );

      if (ord.side === 'BUY') {
        db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND env = ? AND asset = ?`).run(
          ord.price * ord.qty,
          ord.user_id,
          ord.env,
          quote
        );
        db.prepare(`
          INSERT INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
          VALUES (?, ?, ?, ?, ?, 0, '{}')
          ON CONFLICT(user_id, env, asset) DO UPDATE SET available = available + ?
        `).run(`${ord.user_id}_${ord.env}_${base}`, ord.user_id, ord.env, base, ord.qty, ord.qty);
      } else {
        db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND env = ? AND asset = ?`).run(
          ord.qty,
          ord.user_id,
          ord.env,
          base
        );
        const netUsdt = Math.max(0, totalQuote - fee);
        db.prepare(`UPDATE wallets SET available = available + ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
          netUsdt,
          ord.user_id,
          ord.env,
          quote
        );
      }
    });
    tx();

    const notif = createNotification(
      ord.user_id,
      'ORDERS',
      `Orden ${ord.type} ejecutada (${ord.env})`,
      `${ord.side} ${ord.qty} ${base} @ ${execPrice} ${quote}`
    );
    broadcast('notification:new', notif, ord.user_id);
    broadcast('wallet:updated', { env: ord.env }, ord.user_id);
  }
}

function processOpenFuturesPositions(updates: Array<{ symbol: string; last_price: number }>) {
  const priceMap = new Map(updates.map((u) => [u.symbol, u.last_price]));
  const openPositions = db.prepare(`SELECT * FROM futures_positions WHERE status = 'OPEN'`).all() as Array<{
    id: string;
    user_id: string;
    env: 'DEMO' | 'REAL';
    market_symbol: string;
    side: 'LONG' | 'SHORT';
    margin_mode: string;
    leverage: number;
    entry_price: number;
    qty: number;
    margin: number;
    liq_price: number;
    stop_loss: number;
    take_profit: number;
  }>;

  for (const pos of openPositions) {
    const price = priceMap.get(pos.market_symbol);
    if (!price) continue;

    const pnl =
      pos.side === 'LONG'
        ? (price - pos.entry_price) * pos.qty
        : (pos.entry_price - price) * pos.qty;

    let closeReason: 'LIQUIDATED' | 'HIT_SL' | 'HIT_TP' | null = null;
    if (pos.side === 'LONG') {
      if (price <= pos.liq_price) closeReason = 'LIQUIDATED';
      else if (pos.stop_loss > 0 && price <= pos.stop_loss) closeReason = 'HIT_SL';
      else if (pos.take_profit > 0 && price >= pos.take_profit) closeReason = 'HIT_TP';
    } else {
      if (price >= pos.liq_price) closeReason = 'LIQUIDATED';
      else if (pos.stop_loss > 0 && price >= pos.stop_loss) closeReason = 'HIT_SL';
      else if (pos.take_profit > 0 && price <= pos.take_profit) closeReason = 'HIT_TP';
    }

    if (!closeReason) continue;

    const now = Date.now();
    const finalStatus = closeReason === 'LIQUIDATED' ? 'LIQUIDATED' : 'CLOSED';
    const realized = closeReason === 'LIQUIDATED' ? -pos.margin : Number(pnl.toFixed(2));
    const returnUsdt = closeReason === 'LIQUIDATED' ? 0 : Math.max(0, pos.margin + realized);

    const tx = db.transaction(() => {
      db.prepare(`UPDATE futures_positions SET status = ?, realized_pnl = ?, closed_at = ? WHERE id = ?`).run(
        finalStatus,
        realized,
        now,
        pos.id
      );
      db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = 'USDT'`).run(
        pos.margin,
        returnUsdt,
        pos.user_id,
        pos.env
      );
    });
    tx();

    const notif = createNotification(
      pos.user_id,
      closeReason === 'LIQUIDATED' ? 'LIQUIDATION' : 'ORDERS',
      closeReason === 'LIQUIDATED' ? `Posición liquidada (${pos.env})` : `Posición Futuros cerrada (${closeReason})`,
      `${pos.market_symbol} ${pos.side} ${pos.leverage}x · PnL: ${realized >= 0 ? '+' : ''}${realized.toFixed(2)} USDT`
    );
    broadcast('notification:new', notif, pos.user_id);
    broadcast('futures:updated', { env: pos.env }, pos.user_id);
  }
}

function processActiveQuickTrades(updates: Array<{ symbol: string; last_price: number }>) {
  const priceMap = new Map(updates.map((u) => [u.symbol, u.last_price]));
  const now = Date.now();
  const allActive = db.prepare(`SELECT * FROM quick_trades WHERE status = 'ACTIVE'`).all() as Array<{
    id: string;
    user_id: string;
    env: 'DEMO' | 'REAL';
    symbol: string;
    direction: 'UP' | 'DOWN';
    amount: number;
    duration_sec: number;
    entry_price: number;
    payout_pct: number;
    expires_at: number;
    created_at: number;
    max_positive_pnl: number;
    max_negative_pnl: number;
    pnl_history_json: string;
  }>;

  const updateTickStmt = db.prepare(
    `UPDATE quick_trades SET max_positive_pnl = ?, max_negative_pnl = ?, pnl_history_json = ? WHERE id = ?`
  );

  const marketFallbackStmt = db.prepare(`SELECT last_price FROM markets WHERE symbol = ?`);

  for (const qt of allActive) {
    let currentPrice = priceMap.get(qt.symbol);
    if (!currentPrice || currentPrice <= 0) {
      const mRow = marketFallbackStmt.get(qt.symbol) as { last_price: number } | undefined;
      currentPrice = mRow?.last_price && mRow.last_price > 0 ? mRow.last_price : qt.entry_price;
    }

    let histPts: Array<{ t: number; p: number; pnl: number }> = [];
    try {
      const parsed = JSON.parse(qt.pnl_history_json || '[]');
      if (Array.isArray(parsed)) histPts = parsed;
    } catch {
      histPts = [];
    }

    const evalNow = Math.min(now, qt.expires_at);
    const liveMetrics = computeQuickTradeLiveMetrics({
      direction: qt.direction,
      amount: qt.amount,
      entryPrice: qt.entry_price,
      currentPrice,
      payoutPct: qt.payout_pct,
      createdAt: qt.created_at,
      expiresAt: qt.expires_at,
      nowMs: evalNow,
    });

    const nextMaxPos = Number(Math.max(qt.max_positive_pnl || 0, Math.max(0, liveMetrics.dynamicPnl)).toFixed(2));
    const nextMaxNeg = Number(Math.min(qt.max_negative_pnl || 0, Math.min(0, liveMetrics.dynamicPnl)).toFixed(2));

    if (qt.expires_at > now) {
      histPts.push({ t: now, p: currentPrice, pnl: liveMetrics.dynamicPnl });
      if (histPts.length > 180) histPts = histPts.slice(-180);
      updateTickStmt.run(nextMaxPos, nextMaxNeg, JSON.stringify(histPts), qt.id);
      broadcast(
        'quicktrade:tick',
        {
          id: qt.id,
          currentPrice,
          dynamicPnl: liveMetrics.dynamicPnl,
          dynamicReturnPct: liveMetrics.dynamicReturnPct,
          maxPositivePnl: nextMaxPos,
          maxNegativePnl: nextMaxNeg,
        },
        qt.user_id
      );
      continue;
    }

    // Trade reached expiration -> settle strictly with the final dynamic PnL obtained at close
    const closePrice = currentPrice;
    const settlement = computeQuickTradeSettlement({
      direction: qt.direction,
      amount: qt.amount,
      entryPrice: qt.entry_price,
      closePrice,
      payoutPct: qt.payout_pct,
      createdAt: qt.created_at,
      expiresAt: qt.expires_at,
      settledAt: now,
    });
    const { status, profit, returnAmount, returnPct: finalReturnPct } = settlement;

    const effectiveSec = Math.max(1, Math.round((now - qt.created_at) / 1000));
    const settledMaxPos = Number(Math.max(nextMaxPos, Math.max(0, profit)).toFixed(2));
    const settledMaxNeg = Number(Math.min(nextMaxNeg, Math.min(0, profit)).toFixed(2));
    histPts.push({ t: qt.expires_at, p: closePrice, pnl: profit });
    if (histPts.length > 180) histPts = histPts.slice(-180);
    const serializedHist = JSON.stringify(histPts);

    let settledChanges = 0;
    const tx = db.transaction(() => {
      const upd = db.prepare(
        `UPDATE quick_trades
         SET status = ?, close_price = ?, profit = ?, return_pct = ?, closed_at = ?,
             max_positive_pnl = ?, max_negative_pnl = ?, effective_duration_sec = ?, pnl_history_json = ?
         WHERE id = ? AND status = 'ACTIVE'`
      ).run(
        status,
        closePrice,
        profit,
        finalReturnPct,
        now,
        settledMaxPos,
        settledMaxNeg,
        effectiveSec,
        serializedHist,
        qt.id
      );
      settledChanges = upd.changes;
      if (upd.changes === 1) {
        db.prepare(
          `UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = 'USDT'`
        ).run(qt.amount, returnAmount, qt.user_id, qt.env);
      }
    });
    tx();
    if (settledChanges === 0) continue;

    const notif = createNotification(
      qt.user_id,
      'ORDERS',
      `Quick Trade ${status === 'WON' ? 'Ganado' : status === 'DRAW' ? 'Empate' : 'Cerrado'} (${qt.env})`,
      `${qt.symbol} ${qt.direction === 'UP' ? 'ALCISTA' : 'BAJISTA'} · Resultado: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USDT`
    );
    broadcast(
      'quicktrade:settled',
      {
        id: qt.id,
        symbol: qt.symbol,
        status,
        close_price: closePrice,
        profit,
        return_pct: finalReturnPct,
        closed_at: now,
        max_positive_pnl: settledMaxPos,
        max_negative_pnl: settledMaxNeg,
        effective_duration_sec: effectiveSec,
        pnl_history_json: serializedHist,
      },
      qt.user_id
    );
    broadcast('notification:new', notif, qt.user_id);
  }
}

function processActiveBots(updates: Array<{ symbol: string; last_price: number }>) {
  const priceMap = new Map(updates.map((u) => [u.symbol, u.last_price]));
  const activeBots = db.prepare(`SELECT * FROM bots WHERE status = 'ACTIVE'`).all() as Array<{
    id: string;
    user_id: string;
    env: 'DEMO' | 'REAL';
    bot_type: string;
    name: string;
    symbol: string;
    allocated_usdt: number;
    trades_count: number;
    wins_count: number;
    pnl: number;
  }>;

  for (const bot of activeBots) {
    const price = priceMap.get(bot.symbol);
    if (!price) continue;
    // Execute periodic algorithmic evaluation (30% chance per cycle to avoid spamming)
    if (Math.random() > 0.35) continue;

    const ind = computeTechnicalIndicators(bot.symbol);
    let side: 'BUY' | 'SELL' = ind.trendBias === 'BEARISH' ? 'SELL' : 'BUY';
    let winProb = 0.56;

    if (bot.bot_type === 'SCALPING' && ind.rsi14 < 38) {
      side = 'BUY';
      winProb = 0.62;
    } else if (bot.bot_type === 'AI_PREDICTIVE') {
      winProb = 0.64;
    } else if (bot.bot_type === 'ARBITRAGE') {
      winProb = 0.72;
    }

    const isWin = Math.random() < winProb;
    const tradeSize = Math.min(bot.allocated_usdt * 0.15, 250);
    const pctMove = isWin ? 0.004 + Math.random() * 0.011 : -(0.003 + Math.random() * 0.008);
    const pnlDelta = Number((tradeSize * pctMove).toFixed(2));
    const qty = Number((tradeSize / price).toFixed(5));

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE bots
        SET trades_count = trades_count + 1,
            wins_count = wins_count + ?,
            pnl = ROUND(pnl + ?, 2)
        WHERE id = ?
      `).run(isWin ? 1 : 0, pnlDelta, bot.id);

      db.prepare(`
        INSERT INTO orders (id, user_id, env, market_symbol, side, type, price, qty, filled_qty, fee, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'MARKET', ?, ?, ?, ?, 'FILLED', ?)
      `).run(
        `ord_bot_${crypto.randomUUID().slice(0, 10)}`,
        bot.user_id,
        bot.env,
        bot.symbol,
        side,
        price,
        qty,
        qty,
        Number((tradeSize * 0.001).toFixed(4)),
        Date.now()
      );

      db.prepare(`UPDATE wallets SET available = MAX(0, available + ?) WHERE user_id = ? AND env = ? AND asset = 'USDT'`).run(
        pnlDelta,
        bot.user_id,
        bot.env
      );
    });
    tx();

    broadcast('bots:updated', { botId: bot.id, pnlDelta }, bot.user_id);
  }
}

let quickSettleInterval: ReturnType<typeof setInterval> | null = null;

export function settleExpiredQuickTradesNow() {
  const now = Date.now();
  const hasExpired = db
    .prepare(`SELECT 1 FROM quick_trades WHERE status = 'ACTIVE' AND expires_at <= ? LIMIT 1`)
    .get(now);
  if (!hasExpired) return;
  const markets = db.prepare(`SELECT symbol, last_price FROM markets WHERE active = 1`).all() as Array<{
    symbol: string;
    last_price: number;
  }>;
  processActiveQuickTrades(markets);
}

export function startMarketEngine() {
  if (tickInterval) return;
  syncBinancePublicPrices();
  tickInterval = setInterval(updateMarketsTick, 2000);
  quickSettleInterval = setInterval(settleExpiredQuickTradesNow, 500);
  binanceSyncInterval = setInterval(syncBinancePublicPrices, 30000);
}

export function stopMarketEngine() {
  if (tickInterval) clearInterval(tickInterval);
  if (quickSettleInterval) clearInterval(quickSettleInterval);
  if (binanceSyncInterval) clearInterval(binanceSyncInterval);
  tickInterval = null;
  quickSettleInterval = null;
  binanceSyncInterval = null;
}
