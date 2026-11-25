import { DEFAULT_MARKETS } from './defaultMarkets';
import type { Candle, OrderBook, TechnicalIndicators } from './types';

const TOKEN_STORAGE_KEY = 'cryptoai_jwt_token';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setStoredToken(token: string) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function isVercelStaticHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith('vercel.app');
}

async function fetchBinanceChartFallback(base: string, quote: string, tf: string) {
  const cleanSym = `${base}${quote}`.toUpperCase();
  const validIntervals: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  const interval = validIntervals[tf] || '1m';
  let candles: Candle[] = [];

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(cleanSym)}&interval=${interval}&limit=120`
    );
    if (res.ok) {
      const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
      candles = raw.map((r) => ({
        time: Math.floor(r[0] / 1000),
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5]),
      }));
    }
  } catch {
    // fallback to synthetic candles if symbol not on Binance (e.g. CAIX/USDT)
  }

  if (candles.length === 0) {
    const mkt = DEFAULT_MARKETS.find((m) => m.symbol === `${base}/${quote}`);
    const anchor = mkt?.last_price || 1.45;
    const nowSec = Math.floor(Date.now() / 1000);
    const aligned = nowSec - (nowSec % 60);
    let p = anchor * 0.99;
    for (let i = 100; i >= 0; i--) {
      const open = p;
      const close = Math.max(anchor * 0.5, open + (anchor - open) * 0.05 + open * (Math.random() - 0.495) * 0.004);
      candles.push({
        time: aligned - i * 60,
        open: Number(open.toFixed(6)),
        high: Number((Math.max(open, close) * 1.002).toFixed(6)),
        low: Number((Math.min(open, close) * 0.998).toFixed(6)),
        close: Number(close.toFixed(6)),
        volume: Number((120 + Math.random() * 200).toFixed(2)),
      });
      p = close;
    }
  }

  const lastPrice = candles[candles.length - 1]?.close || 100;
  const bids = Array.from({ length: 12 }, (_, idx) => {
    const price = Number((lastPrice * (1 - 0.00025 * (idx + 1))).toFixed(lastPrice > 10 ? 2 : 4));
    const qty = Number((0.2 + Math.random() * 2.5).toFixed(3));
    return { price, qty, total: Number((price * qty).toFixed(2)) };
  });
  const asks = Array.from({ length: 12 }, (_, idx) => {
    const price = Number((lastPrice * (1 + 0.00025 * (idx + 1))).toFixed(lastPrice > 10 ? 2 : 4));
    const qty = Number((0.2 + Math.random() * 2.5).toFixed(3));
    return { price, qty, total: Number((price * qty).toFixed(2)) };
  });

  const orderBook: OrderBook = {
    symbol: `${base}/${quote}`,
    lastPrice,
    spreadPct: 0.05,
    bids,
    asks,
  };

  const indicators: TechnicalIndicators = {
    symbol: `${base}/${quote}`,
    lastPrice,
    rsi14: 54.2,
    ema9: Number((lastPrice * 0.999).toFixed(4)),
    ema21: Number((lastPrice * 0.997).toFixed(4)),
    sma20: Number((lastPrice * 0.998).toFixed(4)),
    macd: 12.4,
    macdSignal: 9.8,
    bbUpper: Number((lastPrice * 1.012).toFixed(4)),
    bbMiddle: lastPrice,
    bbLower: Number((lastPrice * 0.988).toFixed(4)),
    atr14: Number((lastPrice * 0.008).toFixed(4)),
    support: Number((lastPrice * 0.985).toFixed(4)),
    resistance: Number((lastPrice * 1.015).toFixed(4)),
    volatilityPct: 1.42,
    trendBias: 'BULLISH',
  };

  return { candles, orderBook, indicators };
}

async function handleVercelApiFallback<T>(url: string): Promise<T | null> {
  if (url.startsWith('/api/health')) {
    return { ok: true, mode: 'vercel-supabase' } as unknown as T;
  }
  if (url === '/api/markets') {
    return { markets: DEFAULT_MARKETS } as unknown as T;
  }
  if (url === '/api/bootstrap') {
    return {
      branding: { name: 'PUKUN TRADE' },
      modules: {},
    } as unknown as T;
  }
  if (url === '/api/signals') {
    return { signals: [] } as unknown as T;
  }
  if (url === '/api/tokens') {
    return { tokens: [] } as unknown as T;
  }
  if (url.startsWith('/api/wallet')) {
    return {
      wallets: [],
      summary: { totalUsdt: 10000, availableUsdt: 10000, lockedUsdt: 0 },
      transactions: [],
      whitelist: [],
    } as unknown as T;
  }
  if (url.startsWith('/api/spot/orders')) {
    return { orders: [] } as unknown as T;
  }
  if (url.startsWith('/api/futures/positions')) {
    return { positions: [] } as unknown as T;
  }
  if (url.startsWith('/api/bots')) {
    return { bots: [], templates: [] } as unknown as T;
  }
  if (url.startsWith('/api/notifications')) {
    return { notifications: [] } as unknown as T;
  }
  if (url.startsWith('/api/quick-trade/history')) {
    return { trades: [] } as unknown as T;
  }

  // Live Binance chart candles for Spot, Futures & Quick Trading
  const chartMatch = url.match(/^\/api\/markets\/([^/]+)\/([^/?]+)\/chart(?:\?tf=([^&]+))?/);
  if (chartMatch) {
    const base = decodeURIComponent(chartMatch[1]);
    const quote = decodeURIComponent(chartMatch[2]);
    const tf = chartMatch[3] || '1m';
    const chartData = await fetchBinanceChartFallback(base, quote, tf);
    return chartData as unknown as T;
  }

  return null;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  // On Vercel static deployment, resolve read-only /api routes via Binance & local fallback without 404 console spam
  if (isVercelStaticHost() && (!options.method || options.method.toUpperCase() === 'GET') && url.startsWith('/api/')) {
    const handled = await handleVercelApiFallback<T>(url);
    if (handled !== null) return handled;
  }

  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || `Error HTTP ${res.status}`);
  }
  const data = await res.json();
  return data as T;
}

export function formatCurrency(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPrice(price: number): string {
  if (price >= 1000) return formatCurrency(price, 2);
  if (price >= 10) return formatCurrency(price, 2);
  if (price >= 1) return formatCurrency(price, 4);
  return formatCurrency(price, 4);
}
