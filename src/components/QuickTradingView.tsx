import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Flame,
  Layers,
  Radio,
  Share2,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatCurrency, formatPrice, getStoredToken } from '../api';
import { triggerTradeResultFx } from './TradeResultFx';
import { computeCustomTokenNextPrice } from '../vercelEngine';
import {
  Candle,
  Market,
  QuickTradeItem,
  QuickTradePnlPoint,
  TechnicalIndicators,
  TradingEnv,
  WalletItem,
} from '../types';
import {
  computeQuickTradeLiveMetrics,
  DEFAULT_QUICK_TRADE_CONFIG,
  formatCountdown,
  formatDurationLabel,
  mergeQuickTradeConfig,
  QuickTradeConfig,
  resolveQuickTradePayout,
} from '../utils/quickTradeMath';
import { QuickTradePnlChart } from './QuickTradePnlChart';
import { ChartIndicatorsToggle, PulsePoint, QuickTradePulseChart } from './QuickTradePulseChart';
import { QuickTradeStatsAndHistory } from './QuickTradeStatsAndHistory';
import { ShareTradeModal, ShareTradePayload } from './ShareTradeModal';

interface Props {
  env: TradingEnv;
  markets: Market[];
  selectedSymbol: string;
  wallets: WalletItem[];
  referralCode?: string;
  referralRewardUsdt?: number;
  onChangeSymbol: (symbol: string) => void;
  onSettled: () => void;
}

const CHART_WINDOWS = [
  { sec: 15, label: '15s' },
  { sec: 30, label: '30s' },
  { sec: 60, label: '1m' },
  { sec: 180, label: '3m' },
  { sec: 300, label: '5m' },
];

type WsStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

function formatCompactVolume(vol: number): string {
  if (!Number.isFinite(vol) || vol <= 0) return '0.00';
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(2)}K`;
  return vol.toFixed(2);
}

function seedPulseFromCandles(candles: Candle[]): PulsePoint[] {
  if (!candles || candles.length === 0) return [];
  const recent = candles.slice(-20);
  const result: PulsePoint[] = [];
  const totalLen = recent.length;

  recent.forEach((c, idx) => {
    const baseMs = c.time * 1000;
    if (idx >= totalLen - 8) {
      const bullish = c.close >= c.open;
      const mid1 = bullish ? c.low : c.high;
      const mid2 = bullish ? c.high : c.low;
      const qVol = Math.max(0.01, c.volume / 4);
      result.push(
        { time: baseMs, price: c.open, volume: qVol },
        { time: baseMs + 15000, price: mid1, volume: qVol },
        { time: baseMs + 35000, price: mid2, volume: qVol },
        { time: baseMs + 55000, price: c.close, volume: qVol }
      );
    } else {
      result.push({ time: baseMs + 55000, price: c.close, volume: c.volume });
    }
  });

  for (let i = 1; i < result.length; i++) {
    if (result[i].time <= result[i - 1].time) {
      result[i].time = result[i - 1].time + 1000;
    }
  }
  return result;
}

export function QuickTradingView({
  env,
  markets,
  selectedSymbol,
  wallets,
  referralCode = 'PUKUN-40USDT',
  referralRewardUsdt = 40,
  onChangeSymbol,
  onSettled,
}: Props) {
  const currentMarket = useMemo(
    () => markets.find((m) => m.symbol === selectedSymbol) || markets[0],
    [markets, selectedSymbol]
  );

  // Admin-backed Quick Trading Config
  const [qtConfig, setQtConfig] = useState<QuickTradeConfig>(DEFAULT_QUICK_TRADE_CONFIG);

  // Independent Visual Chart Timeframe vs Trade Expiration Duration
  const [chartWindowSec, setChartWindowSec] = useState<number>(60);
  const [durationSec, setDurationSec] = useState<number>(30);

  // Toggleable chart & technical indicators
  const [indicatorsToggle, setIndicatorsToggle] = useState<ChartIndicatorsToggle>({
    ema: true,
    bollinger: false,
    volume: true,
  });
  const [showRsi, setShowRsi] = useState<boolean>(true);
  const [showMacd, setShowMacd] = useState<boolean>(true);

  // Streaming quote buffer, WS status, latency & staleness detection
  const [pulsePoints, setPulsePoints] = useState<PulsePoint[]>([]);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>('RECONNECTING');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastTickReceivedAt, setLastTickReceivedAt] = useState<number>(() => Date.now());
  const [liveMarketPatch, setLiveMarketPatch] = useState<{
    last_price: number;
    high_24h: number;
    low_24h: number;
    change_24h: number;
    price_source: string;
  } | null>(null);

  // Operation state & Advanced History
  const [amount, setAmount] = useState('50');
  const [history, setHistory] = useState<QuickTradeItem[]>([]);
  const [accountFilter, setAccountFilter] = useState<'CURRENT' | 'DEMO' | 'REAL' | 'ALL'>('CURRENT');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [hoverDirection, setHoverDirection] = useState<'UP' | 'DOWN' | null>(null);
  const [lastClosedTrade, setLastClosedTrade] = useState<QuickTradeItem | null>(null);
  const [shareTrade, setShareTrade] = useState<ShareTradePayload | null>(null);
  const latestPriceRef = useRef<number>(0);

  // Live Active Trade PnL Trajectory Buffer (for Requirement 3 smooth curve + 1s delta)
  const [activePnlPoints, setActivePnlPoints] = useState<QuickTradePnlPoint[]>([]);
  const [pnlDirectionAnim, setPnlDirectionAnim] = useState<'UP' | 'DOWN' | 'FLAT'>('FLAT');
  const prevDynamicPnlRef = useRef<number>(0);

  const selectedSymRef = useRef<string>(currentMarket?.symbol || selectedSymbol);
  selectedSymRef.current = currentMarket?.symbol || selectedSymbol;

  const lastTickDedupRef = useRef<{ time: number; price: number }>({ time: 0, price: 0 });
  const prevActiveIdRef = useRef<string | null>(null);
  const historyRef = useRef<QuickTradeItem[]>([]);
  const durationSecRef = useRef<number>(durationSec);
  durationSecRef.current = durationSec;

  const usdtBalance = wallets.find((w) => w.asset === 'USDT')?.available || 0;

  const [chartHeight, setChartHeight] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 300 : 390
  );

  useEffect(() => {
    const onResize = () => {
      setChartHeight(window.innerWidth < 640 ? 300 : 390);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 100ms high-resolution clock for timer & smooth countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => clearInterval(timer);
  }, []);

  const loadHistoryAndConfig = useCallback(async () => {
    try {
      const fetchEnv = accountFilter === 'CURRENT' ? env : accountFilter;
      const hintQs =
        latestPriceRef.current > 0
          ? `&sym=${encodeURIComponent(selectedSymRef.current)}&price=${encodeURIComponent(String(latestPriceRef.current))}`
          : '';
      const res = await apiFetch<{ trades: QuickTradeItem[]; config?: Partial<QuickTradeConfig> }>(
        `/api/quick-trade/history?env=${fetchEnv}${hintQs}`
      );
      if (Array.isArray(res.trades)) {
        const prevActiveIds = new Set(historyRef.current.filter((t) => t.status === 'ACTIVE').map((t) => t.id));
        const newlySettled = res.trades.find(
          (t) => prevActiveIds.has(t.id) && (t.status === 'WON' || t.status === 'LOST')
        );
        if (newlySettled) {
          triggerTradeResultFx(
            newlySettled.profit,
            newlySettled.status === 'WON' ? '¡QUICK TRADE GANADO!' : 'QUICK TRADE PERDIDO'
          );
          setLastClosedTrade(newlySettled);
          onSettledRef.current();
        }
        historyRef.current = res.trades;
        setHistory(res.trades);
        setLastClosedTrade((curr) => {
          if (!curr) return curr;
          const fresh = res.trades.find((t) => t.id === curr.id && t.status !== 'ACTIVE');
          return fresh || curr;
        });
      }
      if (res.config) {
        const merged = mergeQuickTradeConfig(res.config);
        setQtConfig(merged);
        if (merged.durations.length > 0 && !merged.durations.includes(durationSecRef.current)) {
          setDurationSec(merged.durations[0]);
        }
      }
    } catch {
      // ignore transient error
    }
  }, [env, accountFilter]);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const loadHistoryRef = useRef(loadHistoryAndConfig);
  loadHistoryRef.current = loadHistoryAndConfig;

  useEffect(() => {
    loadHistoryAndConfig();
  }, [loadHistoryAndConfig]);

  // Seed historical candles & indicators on symbol change
  useEffect(() => {
    if (!currentMarket) return;
    let cancelled = false;
    setLiveMarketPatch(null);
    lastTickDedupRef.current = { time: 0, price: 0 };

    const [base, quote] = currentMarket.symbol.split('/');
    const reqStart = performance.now();

    apiFetch<{ candles: Candle[]; indicators: TechnicalIndicators }>(
      `/api/markets/${encodeURIComponent(base)}/${encodeURIComponent(quote)}/chart?tf=1m`
    )
      .then((res) => {
        if (cancelled) return;
        setLatencyMs(Math.max(1, Math.round(performance.now() - reqStart)));
        setLastTickReceivedAt(Date.now());
        const seeded = seedPulseFromCandles(Array.isArray(res.candles) ? res.candles : []);
        const now = Date.now();
        const currentPrice = currentMarket.last_price;
        if (seeded.length > 0) {
          const tail = seeded[seeded.length - 1];
          if (now - tail.time > 1500) {
            seeded.push({ time: now, price: currentPrice, volume: Math.max(1, tail.volume * 0.25) });
          }
          lastTickDedupRef.current = { time: seeded[seeded.length - 1].time, price: seeded[seeded.length - 1].price };
          setPulsePoints(seeded);
        } else {
          lastTickDedupRef.current = { time: now, price: currentPrice };
          setPulsePoints([{ time: now, price: currentPrice, volume: 1 }]);
        }
        if (res.indicators) setIndicators(res.indicators);
      })
      .catch(() => {
        if (cancelled) return;
        const now = Date.now();
        setPulsePoints([{ time: now, price: currentMarket.last_price, volume: 1 }]);
      });

    return () => {
      cancelled = true;
    };
  }, [currentMarket?.symbol]);

  const pushQuoteTick = useCallback((price: number, volumeHint?: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    const now = Date.now();
    setLastTickReceivedAt(now);
    const prev = lastTickDedupRef.current;

    if (now - prev.time < 350 && Math.abs(price - prev.price) <= price * 1e-8) {
      return;
    }

    const safeTime = Math.max(now, prev.time + 50);
    lastTickDedupRef.current = { time: safeTime, price };

    setPulsePoints((curr) => {
      const lastPt = curr[curr.length - 1];
      if (lastPt && Math.abs(lastPt.price - price) <= price * 1e-8 && safeTime - lastPt.time < 1200) {
        return curr;
      }
      const vol = volumeHint && volumeHint > 0 ? volumeHint : lastPt ? Math.max(1, lastPt.volume * 0.92) : 12;
      const next = [...curr, { time: safeTime, price, volume: vol }];
      return next.length > 450 ? next.slice(-450) : next;
    });
  }, []);

  const pushQuoteTickRef = useRef(pushQuoteTick);
  pushQuoteTickRef.current = pushQuoteTick;

  // Dedicated stable WebSocket stream for Quick Trading Pro (never restarts on parent re-renders)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let closedByCleanup = false;

    const isVercelHost = typeof window !== 'undefined' && window.location.hostname.endsWith('vercel.app');
    if (isVercelHost) {
      setWsStatus('CONNECTED');
      setLastTickReceivedAt(Date.now());
      let anchorPrice = 0;
      let microPrice = 0;
      let momentum = 0;

      const pollMarketAnchor = async () => {
        if (closedByCleanup) return;
        const t0 = performance.now();
        try {
          const sym = selectedSymRef.current || 'BTC/USDT';
          // Check if it's a custom Token Factory asset first
          const customPrice = computeCustomTokenNextPrice(sym);
          if (customPrice !== null) {
            anchorPrice = customPrice;
            if (!microPrice) microPrice = customPrice;
            setLatencyMs(12);
            setLastTickReceivedAt(Date.now());
            setLiveMarketPatch({
              last_price: customPrice,
              change_24h: 2.4,
              high_24h: customPrice * 1.03,
              low_24h: customPrice * 0.97,
              price_source: 'PUKUN_TOKEN_ENGINE',
            });
            return;
          }

          const cleanSym = sym.replace('/', '');
          const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(cleanSym)}`);
          if (res.ok && !closedByCleanup) {
            const d = (await res.json()) as {
              lastPrice: string;
              priceChangePercent: string;
              highPrice: string;
              lowPrice: string;
            };
            const lp = parseFloat(d.lastPrice);
            anchorPrice = lp;
            if (!microPrice || Math.abs(microPrice - lp) / lp > 0.03) microPrice = lp;
            setLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
            setLastTickReceivedAt(Date.now());
            setLiveMarketPatch({
              last_price: lp,
              change_24h: parseFloat(d.priceChangePercent),
              high_24h: parseFloat(d.highPrice),
              low_24h: parseFloat(d.lowPrice),
              price_source: 'BINANCE_LIVE',
            });
          }
        } catch {
          // ignore transient fetch errors
        }
      };

      // High-definition 450ms market micro-tick generator for detailed, realistic chart movement
      const emitMicroTick = () => {
        if (closedByCleanup) return;
        if (!anchorPrice || anchorPrice <= 0) return;
        const pullToAnchor = (anchorPrice - microPrice) * 0.22;
        momentum = momentum * 0.55 + (Math.random() - 0.5) * anchorPrice * 0.00028;
        microPrice = Math.max(anchorPrice * 0.5, microPrice + pullToAnchor + momentum);
        const rounded = Number(microPrice.toFixed(anchorPrice > 100 ? 2 : anchorPrice > 1 ? 4 : 6));
        latestPriceRef.current = rounded;
        setLastTickReceivedAt(Date.now());
        setLiveMarketPatch((prev) => ({
          ...(prev || { change_24h: 0, high_24h: rounded, low_24h: rounded, price_source: 'BINANCE_LIVE' }),
          last_price: rounded,
        }));
        pushQuoteTickRef.current(rounded);

        // Settle any expired active quick trade immediately
        const now = Date.now();
        if (historyRef.current.some((t) => t.status === 'ACTIVE' && now >= t.expires_at)) {
          loadHistoryRef.current();
        }
      };

      pollMarketAnchor();
      const pollTimer = setInterval(pollMarketAnchor, 2000);
      const microTimer = setInterval(emitMicroTick, 450);
      return () => {
        closedByCleanup = true;
        clearInterval(pollTimer);
        clearInterval(microTimer);
      };
    }

    const measureRestLatency = async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/health');
        if (!closedByCleanup) {
          setLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
        }
      } catch {
        // ignore
      }
    };

    const connect = () => {
      if (closedByCleanup) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getStoredToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);

      ws.onopen = () => {
        if (closedByCleanup) return;
        setWsStatus('CONNECTED');
        setLastTickReceivedAt(Date.now());
        measureRestLatency();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { event: string; payload?: unknown };
          if (msg.event === 'ws:connected') {
            setWsStatus('CONNECTED');
          } else if (msg.event === 'market:ticks' && Array.isArray(msg.payload)) {
            setLastTickReceivedAt(Date.now());
            const sym = selectedSymRef.current;
            const match = (
              msg.payload as Array<{
                symbol: string;
                last_price: number;
                change_24h: number;
                high_24h: number;
                low_24h: number;
                price_source: string;
              }>
            ).find((u) => u.symbol === sym);

            if (match) {
              setLiveMarketPatch({
                last_price: match.last_price,
                change_24h: match.change_24h,
                high_24h: match.high_24h,
                low_24h: match.low_24h,
                price_source: match.price_source,
              });
              pushQuoteTickRef.current(match.last_price);
            }
          } else if (msg.event === 'quicktrade:tick' && msg.payload) {
            const p = msg.payload as {
              id: string;
              maxPositivePnl?: number;
              maxNegativePnl?: number;
            };
            setHistory((prev) => {
              const updated = prev.map((item) =>
                item.id === p.id
                  ? {
                    ...item,
                    max_positive_pnl: p.maxPositivePnl ?? item.max_positive_pnl,
                    max_negative_pnl: p.maxNegativePnl ?? item.max_negative_pnl,
                  }
                  : item
              );
              historyRef.current = updated;
              return updated;
            });
          } else if (msg.event === 'quicktrade:settled' && msg.payload) {
            const p = msg.payload as {
              id: string;
              symbol?: string;
              status: QuickTradeItem['status'];
              close_price: number;
              profit: number;
              return_pct?: number;
              closed_at?: number;
              max_positive_pnl?: number;
              max_negative_pnl?: number;
              effective_duration_sec?: number;
              pnl_history_json?: string;
            };
            const existing = historyRef.current.find((item) => item.id === p.id);
            const targetSymbol = p.symbol || existing?.symbol;
            if (targetSymbol && targetSymbol === selectedSymRef.current && Number.isFinite(p.close_price) && p.close_price > 0) {
              setLiveMarketPatch((prev) =>
                prev
                  ? { ...prev, last_price: p.close_price }
                  : {
                    last_price: p.close_price,
                    high_24h: p.close_price,
                    low_24h: p.close_price,
                    change_24h: 0,
                    price_source: existing?.price_source || 'SIMULATED_FEED',
                  }
              );
              pushQuoteTickRef.current(p.close_price);
            }
            if (existing) {
              let serializedHistory = p.pnl_history_json;
              if (!serializedHistory) {
                let pts: QuickTradePnlPoint[] = [];
                try {
                  const arr = JSON.parse(existing.pnl_history_json || '[]');
                  if (Array.isArray(arr)) pts = arr;
                } catch {
                  pts = [];
                }
                pts.push({ t: p.closed_at || Date.now(), p: p.close_price, pnl: p.profit });
                serializedHistory = JSON.stringify(pts);
              }
              const settledItem: QuickTradeItem = {
                ...existing,
                status: p.status,
                close_price: p.close_price,
                profit: p.profit,
                return_pct: p.return_pct ?? existing.return_pct,
                closed_at: p.closed_at ?? Date.now(),
                max_positive_pnl: p.max_positive_pnl ?? existing.max_positive_pnl,
                max_negative_pnl: p.max_negative_pnl ?? existing.max_negative_pnl,
                effective_duration_sec: p.effective_duration_sec ?? existing.effective_duration_sec,
                pnl_history_json: serializedHistory,
              };
              const nextList = historyRef.current.map((item) => (item.id === p.id ? settledItem : item));
              historyRef.current = nextList;
              setHistory(nextList);
              setLastClosedTrade(settledItem);
            }
            loadHistoryRef.current();
            onSettledRef.current();
          }
        } catch {
          // ignore malformed WS frames
        }
      };

      ws.onerror = () => {
        if (!closedByCleanup) setWsStatus('RECONNECTING');
      };

      ws.onclose = () => {
        if (closedByCleanup) return;
        setWsStatus('DISCONNECTED');
        reconnectTimer = setTimeout(() => {
          if (!closedByCleanup) {
            setWsStatus('RECONNECTING');
            connect();
          }
        }, 2200);
      };
    };

    connect();
    pingTimer = setInterval(measureRestLatency, 8000);

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (ws) ws.close();
    };
  }, []);

  // Fallback sync from App-level markets prop
  useEffect(() => {
    if (!currentMarket) return;
    pushQuoteTick(currentMarket.last_price);
  }, [currentMarket?.last_price, pushQuoteTick]);

  // Exact expiration trigger + 500ms settlement polling (never cancelled by 100ms clock ticks)
  const firstActiveTrade = history.find((h) => h.status === 'ACTIVE');
  useEffect(() => {
    if (!firstActiveTrade) return;
    const msLeft = Math.max(0, firstActiveTrade.expires_at - Date.now());
    let pollId: ReturnType<typeof setInterval> | null = null;
    const timer = setTimeout(() => {
      loadHistoryRef.current();
      onSettledRef.current();
      pollId = setInterval(() => {
        loadHistoryRef.current();
        onSettledRef.current();
      }, 500);
    }, msLeft + 120);

    return () => {
      clearTimeout(timer);
      if (pollId) clearInterval(pollId);
    };
  }, [firstActiveTrade?.id, firstActiveTrade?.expires_at]);

  // Periodic technical indicator refresh every 15s
  useEffect(() => {
    if (!currentMarket) return;
    const [base, quote] = currentMarket.symbol.split('/');
    const id = setInterval(() => {
      apiFetch<{ indicators: TechnicalIndicators }>(
        `/api/markets/${encodeURIComponent(base)}/${encodeURIComponent(quote)}/chart?tf=1m`
      )
        .then((res) => {
          if (res.indicators) setIndicators(res.indicators);
        })
        .catch(() => { });
    }, 15000);
    return () => clearInterval(id);
  }, [currentMarket?.symbol]);

  // Active trade for current trading environment
  const activeTrade = useMemo(() => history.find((h) => h.status === 'ACTIVE' && h.env === env), [history, env]);

  // Seed / reset live PnL buffer whenever activeTrade ID switches
  useEffect(() => {
    if (!activeTrade) {
      if (prevActiveIdRef.current) {
        const settled = historyRef.current.find(
          (h) => h.id === prevActiveIdRef.current && h.status !== 'ACTIVE'
        );
        if (settled) {
          setLastClosedTrade(settled);
        }
        prevActiveIdRef.current = null;
      }
      setActivePnlPoints((curr) => (curr.length === 0 ? curr : []));
      prevDynamicPnlRef.current = 0;
      setPnlDirectionAnim((curr) => (curr === 'FLAT' ? curr : 'FLAT'));
      return;
    }

    if (prevActiveIdRef.current !== activeTrade.id) {
      prevActiveIdRef.current = activeTrade.id;
      let parsedPts: QuickTradePnlPoint[] = [];
      if (activeTrade.pnl_history_json) {
        try {
          const arr = JSON.parse(activeTrade.pnl_history_json);
          if (Array.isArray(arr)) parsedPts = arr;
        } catch {
          parsedPts = [];
        }
      }
      if (parsedPts.length === 0) {
        parsedPts = [{ t: activeTrade.created_at, p: activeTrade.entry_price, pnl: 0 }];
      }
      setActivePnlPoints(parsedPts);
      prevDynamicPnlRef.current = parsedPts[parsedPts.length - 1]?.pnl || 0;
    }
  }, [activeTrade?.id]);

  // Authoritative market metrics for the selected symbol (and active trade's symbol if different!)
  const livePrice = liveMarketPatch?.last_price ?? currentMarket?.last_price ?? 0;
  const priceSource = liveMarketPatch?.price_source ?? currentMarket?.price_source ?? 'SIMULATED_FEED';
  const isLivePublicSource = priceSource === 'BINANCE_PUBLIC';
  const isConnectionStale = wsStatus !== 'CONNECTED' || nowMs - lastTickReceivedAt > 9000;

  // Price used for activeTrade (if activeTrade is on selectedSymbol use livePrice, else look up markets array)
  const activeTradeCurrentPrice = useMemo(() => {
    if (!activeTrade) return 0;
    if (activeTrade.symbol === currentMarket?.symbol) return livePrice;
    return markets.find((m) => m.symbol === activeTrade.symbol)?.last_price || activeTrade.entry_price;
  }, [activeTrade, currentMarket?.symbol, livePrice, markets]);

  // Real-time Dynamic PnL Metrics (Requirement 1 & 2)
  const liveTradeMetrics = useMemo(() => {
    if (!activeTrade) return null;
    return computeQuickTradeLiveMetrics({
      direction: activeTrade.direction,
      amount: activeTrade.amount,
      entryPrice: activeTrade.entry_price,
      currentPrice: activeTradeCurrentPrice,
      payoutPct: activeTrade.payout_pct,
      createdAt: activeTrade.created_at,
      expiresAt: activeTrade.expires_at,
      nowMs: Math.min(nowMs, activeTrade.expires_at),
      thermalColors: qtConfig.thermalColors,
    });
  }, [activeTrade, activeTradeCurrentPrice, nowMs, qtConfig.thermalColors]);

  const pnlHalfSecBucket = Math.floor(nowMs / 500);

  // Append active trade PnL trajectory points smoothly as ticks/time evolve
  useEffect(() => {
    if (!activeTrade || !liveTradeMetrics || !Number.isFinite(liveTradeMetrics.dynamicPnl)) return;

    const prevVal = prevDynamicPnlRef.current;
    if (liveTradeMetrics.dynamicPnl > prevVal + 0.01) {
      setPnlDirectionAnim((curr) => (curr === 'UP' ? curr : 'UP'));
    } else if (liveTradeMetrics.dynamicPnl < prevVal - 0.01) {
      setPnlDirectionAnim((curr) => (curr === 'DOWN' ? curr : 'DOWN'));
    }
    prevDynamicPnlRef.current = liveTradeMetrics.dynamicPnl;

    const sampleTime = Date.now();
    setActivePnlPoints((curr) => {
      const last = curr[curr.length - 1];
      if (last && sampleTime - last.t < 450 && Math.abs(last.pnl - liveTradeMetrics.dynamicPnl) < 0.01) {
        return curr;
      }
      const next = [...curr, { t: sampleTime, p: activeTradeCurrentPrice, pnl: liveTradeMetrics.dynamicPnl }];
      return next.length > 300 ? next.slice(-300) : next;
    });
  }, [activeTrade?.id, liveTradeMetrics?.dynamicPnl, activeTradeCurrentPrice, pnlHalfSecBucket]);

  // Max Positive, Max Negative, Last-Second Delta & Trend from activePnlPoints
  const activePnlStats = useMemo(() => {
    if (!activeTrade || !liveTradeMetrics) return null;
    const vals = activePnlPoints.map((p) => p.pnl);
    const maxPos = Math.max(
      Number(activeTrade.max_positive_pnl || 0),
      0,
      liveTradeMetrics.dynamicPnl,
      ...(vals.length ? vals : [0])
    );
    const maxNeg = Math.min(
      Number(activeTrade.max_negative_pnl || 0),
      0,
      liveTradeMetrics.dynamicPnl,
      ...(vals.length ? vals : [0])
    );

    const oneSecAgo = nowMs - 1000;
    const ref1s =
      [...activePnlPoints].reverse().find((p) => p.t <= oneSecAgo) || activePnlPoints[0] || { pnl: 0 };
    const delta1s = Number((liveTradeMetrics.dynamicPnl - ref1s.pnl).toFixed(2));
    const trend: 'UP' | 'DOWN' | 'FLAT' = delta1s > 0.02 ? 'UP' : delta1s < -0.02 ? 'DOWN' : 'FLAT';

    return { maxPos, maxNeg, delta1s, trend };
  }, [activeTrade, liveTradeMetrics, activePnlPoints, nowMs]);

  async function handleTrade(direction: 'UP' | 'DOWN') {
    if (!currentMarket) return;
    if (isConnectionStale) {
      setError('Conexión en pausa o reconectando. Espera cotización en vivo antes de operar.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await apiFetch('/api/quick-trade/open', {
        method: 'POST',
        body: JSON.stringify({
          env,
          symbol: currentMarket.symbol,
          direction,
          amount: parseFloat(amount) || 0,
          durationSec,
        }),
      });
      setLastClosedTrade(null);
      await loadHistoryAndConfig();
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al abrir contrato rápido');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGraceCancel() {
    if (!activeTrade) return;
    setError('');
    try {
      await apiFetch(`/api/quick-trade/${activeTrade.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelación manual en ventana de gracia' }),
      });
      await loadHistoryAndConfig();
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar la operación');
    }
  }

  // Period metrics for selected visual chart window
  const periodMetrics = useMemo(() => {
    const cutoff = nowMs - chartWindowSec * 1000;
    const inWin = pulsePoints.filter((p) => p.time >= cutoff);
    const slice = inWin.length >= 2 ? inWin : pulsePoints.slice(-2);
    const openPrice = slice[0]?.price || livePrice;
    const prices = slice.map((p) => p.price);
    if (livePrice > 0) prices.push(livePrice);
    const high = prices.length > 0 ? Math.max(...prices) : livePrice;
    const low = prices.length > 0 ? Math.min(...prices) : livePrice;
    const absDelta = livePrice - openPrice;
    const pctDelta = openPrice > 0 ? (absDelta / openPrice) * 100 : 0;
    return { openPrice, high, low, absDelta, pctDelta };
  }, [pulsePoints, chartWindowSec, livePrice, nowMs]);

  const trendLabel = useMemo<'ALCISTA' | 'BAJISTA' | 'LATERAL'>(() => {
    if (indicators?.trendBias === 'BULLISH') return 'ALCISTA';
    if (indicators?.trendBias === 'BEARISH') return 'BAJISTA';
    if (periodMetrics.pctDelta > 0.03) return 'ALCISTA';
    if (periodMetrics.pctDelta < -0.03) return 'BAJISTA';
    return 'LATERAL';
  }, [indicators?.trendBias, periodMetrics.pctDelta]);

  // Dynamic Payout for current (symbol, durationSec)
  const resolvedPayoutPct = useMemo(
    () => resolveQuickTradePayout(qtConfig, currentMarket?.symbol || selectedSymbol, durationSec),
    [qtConfig, currentMarket?.symbol, selectedSymbol, durationSec]
  );

  const parsedAmount = parseFloat(amount) || 0;
  const potentialProfit = parsedAmount * (resolvedPayoutPct / 100);
  const potentialReturn = parsedAmount + potentialProfit;

  const activeTiming = useMemo(() => {
    if (!activeTrade) return null;
    const totalMs = Math.max(1000, activeTrade.duration_sec * 1000);
    const remMs = Math.max(0, activeTrade.expires_at - nowMs);
    const remSec = Math.ceil(remMs / 1000);
    const progressPct = Math.min(100, Math.max(0, (remMs / totalMs) * 100));
    const isUrgent = remSec <= 10;
    const isClosingNow = remMs <= 1000;
    const canGraceCancel = nowMs - activeTrade.created_at <= 3000;
    return { totalMs, remMs, remSec, progressPct, isUrgent, isClosingNow, canGraceCancel };
  }, [activeTrade, nowMs]);

  const ringRadius = 40;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = activeTiming ? ringCircumference * (1 - activeTiming.progressPct / 100) : 0;

  const tColors = qtConfig.thermalColors;
  const animOn = qtConfig.animationsEnabled;

  return (
    <div className="space-y-4">
      {/* Top Status & Source Transparency Strip */}
      <div className="rounded-xl border border-blue-500/25 bg-[#0D1320] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3 text-slate-300">
          <ShieldAlert className="h-4 w-4 text-blue-400 shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-semibold text-white">QUICK TRADING PRO ({env}):</span>{' '}
            Payout máximo configurado para {currentMarket?.symbol} ({formatDurationLabel(durationSec)}):{' '}
            <span className="font-mono font-bold text-emerald-400">+{resolvedPayoutPct}%</span> (cierre al último PnL dinámico).{' '}
            {env === 'DEMO'
              ? 'Operas con capital virtual DEMO sin riesgo financiero real.'
              : 'Modo REAL sujeto a disponibilidad y autorizaciones.'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          <span
            className={`font-semibold ${env === 'DEMO' ? 'text-amber-300' : isLivePublicSource ? 'text-emerald-400' : 'text-amber-300'
              }`}
          >
            {env === 'DEMO'
              ? isLivePublicSource
                ? 'DEMO · COTIZACIÓN PÚBLICA EN VIVO'
                : 'DEMO SIMULADO · FEED SINTÉTICO'
              : isLivePublicSource
                ? 'COTIZACIÓN PÚBLICA EN VIVO'
                : 'FEED INTERNO SIMULADO'}
          </span>
          <span className="text-slate-600">·</span>
          <span
            className={`inline-flex items-center gap-1.5 ${wsStatus === 'CONNECTED' && !isConnectionStale
                ? 'text-emerald-400'
                : wsStatus === 'RECONNECTING'
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
          >
            {wsStatus === 'CONNECTED' && !isConnectionStale ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            {wsStatus === 'CONNECTED' && !isConnectionStale
              ? 'WS En Vivo'
              : wsStatus === 'RECONNECTING'
                ? 'Reconectando...'
                : 'Sin Conexión'}
          </span>
          {latencyMs !== null && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400 tabular-nums">{latencyMs} ms</span>
            </>
          )}
        </div>
      </div>

      {/* Disconnection Warning Banner (Requirement 8: never disguise stale prices as live) */}
      {isConnectionStale && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/12 px-4 py-3 flex items-center gap-3 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <div>
            <span className="font-bold">CONEXIÓN INTERRUMPIDA:</span> No se reciben cotizaciones actualizadas del
            servidor. Se bloquea la apertura de nuevas operaciones para evitar ejecutar sobre precios antiguos.
          </div>
        </div>
      )}

      {/* Main Trading Terminal Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN (xl:col-span-8): Telemetry + ECG Price Pulse + Dynamic PnL Performance Chart */}
        <div className="xl:col-span-8 space-y-4">
          {/* Price Pulse Chart Card */}
          <div className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-3.5">
            {/* Asset Selector, Live Price, Variation & AI Trend */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-white/8">
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label="Seleccionar criptomoneda"
                  value={currentMarket?.symbol || ''}
                  onChange={(e) => onChangeSymbol(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#080B11] px-3 py-2 text-sm font-bold text-white focus:border-blue-500 focus:outline-none"
                >
                  {markets.map((m) => (
                    <option key={m.symbol} value={m.symbol}>
                      {m.symbol}
                    </option>
                  ))}
                </select>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Radio className={`h-3 w-3 text-sky-400 ${animOn && !isConnectionStale ? 'animate-pulse' : ''}`} />
                    <span>Precio Actual {isConnectionStale ? '(Último conocido)' : ''}</span>
                  </div>
                  <div className="font-mono text-2xl font-bold text-white tabular-nums tracking-tight">
                    ${formatPrice(livePrice)}
                  </div>
                </div>

                <div className="h-8 w-px bg-white/10 hidden sm:block" />

                <div>
                  <div className="text-[11px] text-slate-400">
                    Variación ({CHART_WINDOWS.find((w) => w.sec === chartWindowSec)?.label})
                  </div>
                  <div
                    className={`font-mono text-sm font-semibold tabular-nums flex items-center gap-1 ${periodMetrics.absDelta >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                  >
                    {periodMetrics.absDelta >= 0 ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {periodMetrics.absDelta >= 0 ? '+' : ''}
                      {formatPrice(periodMetrics.absDelta)} ({periodMetrics.pctDelta >= 0 ? '+' : ''}
                      {periodMetrics.pctDelta.toFixed(3)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Trend + AI Violet Indicator */}
              <div className="flex items-center justify-between lg:justify-end gap-4">
                <div className="text-left lg:text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Tendencia Actual</div>
                  <div
                    className={`font-mono text-sm font-bold tracking-wide flex items-center gap-1.5 lg:justify-end ${trendLabel === 'ALCISTA'
                        ? 'text-emerald-400'
                        : trendLabel === 'BAJISTA'
                          ? 'text-red-400'
                          : 'text-sky-400'
                      }`}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    <span>{trendLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Permanent Price Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
              <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                <div className="text-[10px] text-slate-400">
                  {activeTrade ? 'Apertura Operación' : 'Apertura Período'}
                </div>
                <div className="font-mono font-semibold text-slate-100 tabular-nums mt-0.5">
                  ${formatPrice(activeTrade ? activeTrade.entry_price : periodMetrics.openPrice)}
                </div>
              </div>
              <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                <div className="text-[10px] text-slate-400">Máximo Período</div>
                <div className="font-mono font-semibold text-emerald-400 tabular-nums mt-0.5">
                  ${formatPrice(periodMetrics.high)}
                </div>
              </div>
              <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                <div className="text-[10px] text-slate-400">Mínimo Período</div>
                <div className="font-mono font-semibold text-red-400 tabular-nums mt-0.5">
                  ${formatPrice(periodMetrics.low)}
                </div>
              </div>
              <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                <div className="text-[10px] text-slate-400">Volumen 24h</div>
                <div className="font-mono font-semibold text-slate-100 tabular-nums mt-0.5">
                  ${formatCompactVolume(currentMarket?.volume_24h ?? 0)}
                </div>
              </div>
              <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2 col-span-2 sm:col-span-1">
                <div className="text-[10px] text-slate-400">Cambio 24h</div>
                <div
                  className={`font-mono font-semibold tabular-nums mt-0.5 ${(liveMarketPatch?.change_24h ?? currentMarket?.change_24h ?? 0) >= 0
                      ? 'text-emerald-400'
                      : 'text-red-400'
                    }`}
                >
                  {(liveMarketPatch?.change_24h ?? currentMarket?.change_24h ?? 0) >= 0 ? '+' : ''}
                  {(liveMarketPatch?.change_24h ?? currentMarket?.change_24h ?? 0).toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Chart Timeframe (Separate from Operation Duration) + Toggleable Indicators */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[11px] text-slate-400 whitespace-nowrap mr-1 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  Ventana Gráfico:
                </span>
                {CHART_WINDOWS.map((w) => (
                  <button
                    key={w.sec}
                    type="button"
                    onClick={() => setChartWindowSec(w.sec)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap shrink-0 transition-colors cursor-pointer ${chartWindowSec === w.sec
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40 font-semibold'
                        : 'bg-[#080B11] text-slate-400 border border-white/8 hover:text-white'
                      }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400 whitespace-nowrap mr-1 flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />
                  Indicadores:
                </span>
                <button
                  type="button"
                  onClick={() => setIndicatorsToggle((s) => ({ ...s, ema: !s.ema }))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${indicatorsToggle.ema
                      ? 'bg-sky-500/15 border-sky-400/40 text-sky-300 font-semibold'
                      : 'bg-[#080B11] border-white/8 text-slate-400 hover:text-white'
                    }`}
                >
                  EMA
                </button>
                <button
                  type="button"
                  onClick={() => setIndicatorsToggle((s) => ({ ...s, bollinger: !s.bollinger }))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${indicatorsToggle.bollinger
                      ? 'bg-amber-500/15 border-amber-400/40 text-amber-300 font-semibold'
                      : 'bg-[#080B11] border-white/8 text-slate-400 hover:text-white'
                    }`}
                >
                  Bollinger
                </button>
                <button
                  type="button"
                  onClick={() => setIndicatorsToggle((s) => ({ ...s, volume: !s.volume }))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${indicatorsToggle.volume
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300 font-semibold'
                      : 'bg-[#080B11] border-white/8 text-slate-400 hover:text-white'
                    }`}
                >
                  Volumen
                </button>
                <button
                  type="button"
                  onClick={() => setShowRsi((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${showRsi
                      ? 'bg-violet-500/15 border-violet-400/40 text-violet-300 font-semibold'
                      : 'bg-[#080B11] border-white/8 text-slate-400 hover:text-white'
                    }`}
                >
                  RSI
                </button>
                <button
                  type="button"
                  onClick={() => setShowMacd((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${showMacd
                      ? 'bg-blue-500/15 border-blue-400/40 text-blue-300 font-semibold'
                      : 'bg-[#080B11] border-white/8 text-slate-400 hover:text-white'
                    }`}
                >
                  MACD
                </button>
              </div>
            </div>

            {/* ECG Live Price Pulse Chart */}
            <QuickTradePulseChart
              symbol={currentMarket?.symbol || selectedSymbol}
              points={pulsePoints}
              windowSec={chartWindowSec}
              activeTrade={activeTrade}
              hoverDirection={hoverDirection}
              lastClosedTrade={lastClosedTrade}
              indicatorsToggle={indicatorsToggle}
              isLivePublicSource={isLivePublicSource}
              animationsEnabled={animOn}
              thermalColors={tColors}
              height={chartHeight}
            />

            {/* Technical Indicators + AI Violet Context */}
            {(showRsi || showMacd || indicatorsToggle.ema || indicatorsToggle.bollinger) && indicators && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-0.5 text-[11px] font-mono">
                {showRsi && (
                  <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2 flex items-center justify-between">
                    <span className="text-slate-400">RSI (14)</span>
                    <span
                      className={`font-semibold tabular-nums ${indicators.rsi14 >= 70
                          ? 'text-red-400'
                          : indicators.rsi14 <= 30
                            ? 'text-emerald-400'
                            : 'text-sky-300'
                        }`}
                    >
                      {indicators.rsi14.toFixed(1)}
                    </span>
                  </div>
                )}
                {showMacd && (
                  <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2 flex items-center justify-between">
                    <span className="text-slate-400">MACD</span>
                    <span
                      className={`font-semibold tabular-nums ${indicators.macd >= indicators.macdSignal ? 'text-emerald-400' : 'text-red-400'
                        }`}
                    >
                      {indicators.macd >= 0 ? '+' : ''}
                      {indicators.macd.toFixed(3)}
                    </span>
                  </div>
                )}
                {indicatorsToggle.ema && (
                  <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2 flex items-center justify-between">
                    <span className="text-slate-400">EMA 9/21</span>
                    <span className="text-sky-300 font-semibold">
                      {indicators.ema9 > indicators.ema21 ? 'Cruce +' : 'Cruce -'}
                    </span>
                  </div>
                )}
                {indicatorsToggle.bollinger && (
                  <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2 flex items-center justify-between">
                    <span className="text-slate-400">BB Banda</span>
                    <span className="text-amber-300 font-semibold tabular-nums">
                      ${formatPrice(indicators.bbLower)}–${formatPrice(indicators.bbUpper)}
                    </span>
                  </div>
                )}
                <div
                  className="rounded-lg bg-[#080B11] px-3 py-2 flex items-center justify-between col-span-2 sm:col-span-1 border"
                  style={{ borderColor: `${tColors.aiAccent}55` }}
                >
                  <span className="flex items-center gap-1" style={{ color: tColors.aiAccent }}>
                    <Sparkles className="h-3 w-3" />
                    Sesgo IA
                  </span>
                  <span className="font-semibold" style={{ color: tColors.aiAccent }}>
                    {indicators.trendBias === 'BULLISH'
                      ? 'ALCISTA'
                      : indicators.trendBias === 'BEARISH'
                        ? 'BAJISTA'
                        : 'NEUTRAL'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: VISUAL PNL PERFORMANCE PANEL (Live Active Trade OR Just-Closed Trade) */}
          {activeTrade && liveTradeMetrics && activePnlStats ? (
            <div className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Flame className="h-4 w-4" style={{ color: liveTradeMetrics.thermalColor }} />
                    <span>Panel Visual de Rendimiento en Vivo · {activeTrade.symbol}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Evolución segundo a segundo de la valoración provisional frente al punto de equilibrio ($0.00).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-[#080B11] border border-white/8 px-2.5 py-1.5">
                    <span className="text-slate-400 mr-1.5">Δ 1s:</span>
                    <span
                      className={
                        activePnlStats.delta1s > 0
                          ? 'text-emerald-400 font-semibold'
                          : activePnlStats.delta1s < 0
                            ? 'text-red-400 font-semibold'
                            : 'text-slate-300'
                      }
                    >
                      {activePnlStats.delta1s >= 0 ? '+' : ''}
                      {activePnlStats.delta1s.toFixed(2)} USDT
                    </span>
                  </div>
                  <div className="rounded-lg bg-[#080B11] border border-white/8 px-2.5 py-1.5">
                    <span className="text-slate-400 mr-1.5">Tendencia PnL:</span>
                    <span
                      className={
                        activePnlStats.trend === 'UP'
                          ? 'text-emerald-400 font-semibold'
                          : activePnlStats.trend === 'DOWN'
                            ? 'text-red-400 font-semibold'
                            : 'text-sky-300 font-semibold'
                      }
                    >
                      {activePnlStats.trend === 'UP'
                        ? '▲ Subiendo'
                        : activePnlStats.trend === 'DOWN'
                          ? '▼ Bajando'
                          : '● Estable'}
                    </span>
                  </div>
                </div>
              </div>

              <QuickTradePnlChart
                points={activePnlPoints}
                entryPrice={activeTrade.entry_price}
                currentPrice={activeTradeCurrentPrice}
                amount={activeTrade.amount}
                payoutPct={activeTrade.payout_pct}
                createdAt={activeTrade.created_at}
                expiresAt={activeTrade.expires_at}
                maxPositivePnl={activePnlStats.maxPos}
                maxNegativePnl={activePnlStats.maxNeg}
                thermalColor={liveTradeMetrics.thermalColor}
                thermalColors={tColors}
                animationsEnabled={animOn}
                height={185}
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                  <div className="text-[10px] font-sans text-slate-400">Máximo Beneficio Prov.</div>
                  <div className="font-bold mt-0.5" style={{ color: tColors.highProfit }}>
                    +${activePnlStats.maxPos.toFixed(2)} USDT
                  </div>
                </div>
                <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                  <div className="text-[10px] font-sans text-slate-400">Máxima Pérdida Prov.</div>
                  <div className="font-bold mt-0.5" style={{ color: tColors.highLoss }}>
                    -${Math.abs(activePnlStats.maxNeg).toFixed(2)} USDT
                  </div>
                </div>
                <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                  <div className="text-[10px] font-sans text-slate-400">Entrada → Actual</div>
                  <div className="text-white font-semibold mt-0.5">
                    ${formatPrice(activeTrade.entry_price)} → ${formatPrice(activeTradeCurrentPrice)}
                  </div>
                </div>
                <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                  <div className="text-[10px] font-sans text-slate-400">Diferencia Direccional</div>
                  <div
                    className={`font-semibold mt-0.5 ${liveTradeMetrics.signedPricePct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                  >
                    {liveTradeMetrics.signedPricePct >= 0 ? '+' : ''}
                    {liveTradeMetrics.signedPricePct.toFixed(4)}%
                  </div>
                </div>
              </div>
            </div>
          ) : lastClosedTrade ? (
            (() => {
              let closedPts: QuickTradePnlPoint[] = [];
              try {
                const parsed = JSON.parse(lastClosedTrade.pnl_history_json || '[]');
                if (Array.isArray(parsed)) closedPts = parsed;
              } catch {
                closedPts = [];
              }
              if (closedPts.length === 0) {
                closedPts = [
                  { t: lastClosedTrade.created_at, p: lastClosedTrade.entry_price, pnl: 0 },
                  {
                    t: lastClosedTrade.closed_at || lastClosedTrade.expires_at,
                    p: lastClosedTrade.close_price || lastClosedTrade.entry_price,
                    pnl: lastClosedTrade.profit,
                  },
                ];
              }
              const closedColor =
                lastClosedTrade.profit > 0
                  ? tColors.highProfit
                  : lastClosedTrade.profit < 0
                    ? tColors.highLoss
                    : tColors.neutral;
              const closedRetPct =
                lastClosedTrade.return_pct !== undefined
                  ? lastClosedTrade.return_pct
                  : lastClosedTrade.amount > 0
                    ? Number(((lastClosedTrade.profit / lastClosedTrade.amount) * 100).toFixed(2))
                    : 0;
              return (
                <div className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Flame className="h-4 w-4" style={{ color: closedColor }} />
                        <span>Rendimiento Final Registrado · {lastClosedTrade.symbol} ({lastClosedTrade.direction})</span>
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Trayectoria completa de PnL hasta la liquidación definitiva al cierre.
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold" style={{ color: closedColor }}>
                      {lastClosedTrade.profit >= 0 ? '+' : ''}
                      {lastClosedTrade.profit.toFixed(2)} USDT ({closedRetPct >= 0 ? '+' : ''}
                      {closedRetPct.toFixed(2)}%)
                    </span>
                  </div>

                  <QuickTradePnlChart
                    points={closedPts}
                    entryPrice={lastClosedTrade.entry_price}
                    currentPrice={lastClosedTrade.close_price || lastClosedTrade.entry_price}
                    amount={lastClosedTrade.amount}
                    payoutPct={lastClosedTrade.payout_pct}
                    createdAt={lastClosedTrade.created_at}
                    expiresAt={lastClosedTrade.closed_at || lastClosedTrade.expires_at}
                    maxPositivePnl={Number(lastClosedTrade.max_positive_pnl || Math.max(0, lastClosedTrade.profit))}
                    maxNegativePnl={Number(lastClosedTrade.max_negative_pnl || Math.min(0, lastClosedTrade.profit))}
                    thermalColor={closedColor}
                    thermalColors={tColors}
                    animationsEnabled={animOn}
                    height={175}
                  />

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                    <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                      <div className="text-[10px] font-sans text-slate-400">Máximo PnL +</div>
                      <div className="font-bold mt-0.5" style={{ color: tColors.highProfit }}>
                        +${Number(lastClosedTrade.max_positive_pnl || 0).toFixed(2)} USDT
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                      <div className="text-[10px] font-sans text-slate-400">Máximo PnL -</div>
                      <div className="font-bold mt-0.5" style={{ color: tColors.highLoss }}>
                        -${Math.abs(Number(lastClosedTrade.max_negative_pnl || 0)).toFixed(2)} USDT
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                      <div className="text-[10px] font-sans text-slate-400">Entrada → Cierre</div>
                      <div className="text-white font-semibold mt-0.5">
                        ${formatPrice(lastClosedTrade.entry_price)} → ${formatPrice(lastClosedTrade.close_price)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#080B11] border border-white/6 px-3 py-2">
                      <div className="text-[10px] font-sans text-slate-400">Tiempo Efectivo / Payout</div>
                      <div className="text-sky-300 font-semibold mt-0.5">
                        {lastClosedTrade.effective_duration_sec || lastClosedTrade.duration_sec}s · {lastClosedTrade.payout_pct}%
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : null}
        </div>

        {/* RIGHT COLUMN (xl:col-span-4): Dynamic Thermal PnL Monitor + Countdown + Execution Card */}
        <div className="xl:col-span-4 space-y-4">
          {/* SECTION 1 & 2: REAL-TIME DYNAMIC PNL & THERMAL STATE MONITOR */}
          {activeTrade && activeTiming && liveTradeMetrics ? (
            <div
              className="rounded-xl border p-4 space-y-3.5 transition-all duration-500"
              style={{
                borderColor: `${liveTradeMetrics.thermalColor}66`,
                background: `linear-gradient(180deg, ${liveTradeMetrics.thermalColor}1A 0%, #111520 55%)`,
              }}
            >
              {/* Top Row: Countdown Ring + Dynamic PnL Big Number */}
              <div className="flex items-center gap-3.5">
                <div className="relative h-24 w-24 shrink-0 flex items-center justify-center">
                  <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r={ringRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                    <circle
                      cx="50"
                      cy="50"
                      r={ringRadius}
                      fill="none"
                      stroke={activeTiming.isUrgent ? tColors.moderateLoss : liveTradeMetrics.thermalColor}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringDashOffset}
                      className={animOn ? 'transition-[stroke-dashoffset,stroke] duration-200 ease-linear' : ''}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                      className={`font-mono text-2xl font-bold tabular-nums leading-none ${activeTiming.isUrgent && animOn ? 'text-amber-300 animate-pulse' : 'text-white'
                        }`}
                    >
                      {formatCountdown(activeTiming.remSec)}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-slate-400 mt-1">
                      {activeTiming.isClosingNow ? 'CERRANDO' : 'RESTANTE'}
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white truncate">
                      {activeTrade.symbol} · {activeTrade.direction}
                    </span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
                      style={{
                        backgroundColor: `${liveTradeMetrics.thermalColor}24`,
                        color: liveTradeMetrics.thermalColor,
                      }}
                    >
                      {liveTradeMetrics.statusLabel}
                    </span>
                  </div>

                  {/* Animated Dynamic PnL Readout */}
                  <div
                    className={`font-mono text-xl font-extrabold tabular-nums tracking-tight ${animOn ? 'transition-transform duration-300' : ''
                      } ${animOn && pnlDirectionAnim === 'UP'
                        ? '-translate-y-0.5'
                        : animOn && pnlDirectionAnim === 'DOWN'
                          ? 'translate-y-0.5'
                          : ''
                      }`}
                    style={{ color: liveTradeMetrics.thermalColor }}
                  >
                    {liveTradeMetrics.dynamicPnl >= 0 ? '+' : ''}
                    {liveTradeMetrics.dynamicPnl.toFixed(2)} USDT —{' '}
                    {liveTradeMetrics.dynamicPnl >= 0 ? 'GANANCIA' : 'PÉRDIDA'}
                  </div>

                  <div className="text-xs font-mono tabular-nums" style={{ color: liveTradeMetrics.thermalColor }}>
                    {liveTradeMetrics.dynamicReturnPct >= 0 ? '+' : ''}
                    {liveTradeMetrics.dynamicReturnPct.toFixed(2)}% de rendimiento provisional
                  </div>
                </div>
              </div>

              {/* SECTION 2: HORIZONTAL THERMAL BAR WITH MOVING MARKER DOT */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Pérdida Intensa</span>
                  <span>Equilibrio</span>
                  <span>Ganancia Intensa</span>
                </div>
                <div className="relative h-2.5 w-full rounded-full overflow-visible bg-[#080B11] border border-white/10">
                  <div
                    className="h-full w-full rounded-full opacity-85"
                    style={{
                      background: `linear-gradient(90deg, ${tColors.highLoss} 0%, ${tColors.moderateLoss} 28%, ${tColors.neutral} 50%, ${tColors.lowProfit} 72%, ${tColors.highProfit} 100%)`,
                    }}
                  />
                  {/* Moving Thermal Indicator Dot */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-white shadow-md ${animOn ? 'transition-all duration-300 ease-out' : ''
                      }`}
                    style={{
                      left: `${liveTradeMetrics.thermalScore}%`,
                      backgroundColor: liveTradeMetrics.thermalColor,
                      boxShadow: `0 0 10px ${liveTradeMetrics.thermalColor}`,
                    }}
                  />
                </div>
              </div>

              {/* Active Trade Full Parameters */}
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-white/10 font-mono tabular-nums">
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Invertido:</span>
                  <span className="text-white font-semibold">${activeTrade.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Payout:</span>
                  <span className="text-emerald-400 font-semibold">+{activeTrade.payout_pct}%</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Techo máx. venc.:</span>
                  <span className="text-emerald-400 font-semibold">+${liveTradeMetrics.potentialProfit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span className="font-sans">Cierre proyectado:</span>
                  <span
                    className={`font-semibold ${liveTradeMetrics.projectedSettlementPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                  >
                    {liveTradeMetrics.projectedSettlementPnl >= 0 ? '+' : ''}$
                    {liveTradeMetrics.projectedSettlementPnl.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                <span>Se liquida automáticamente al vencimiento con el último PnL dinámico obtenido.</span>
                {activeTiming.canGraceCancel && (
                  <button
                    type="button"
                    onClick={handleGraceCancel}
                    className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/25 shrink-0 cursor-pointer"
                  >
                    <XCircle className="h-3 w-3" />
                    Cancelar (3s)
                  </button>
                )}
              </div>
            </div>
          ) : lastClosedTrade ? (
            /* Full PnL Settlement Summary Card */
            <div
              className={`rounded-xl border p-4 space-y-2.5 ${animOn ? 'transition-all duration-500' : ''
                } ${lastClosedTrade.status === 'WON'
                  ? 'border-emerald-500/45 bg-emerald-500/12'
                  : lastClosedTrade.status === 'LOST'
                    ? 'border-red-500/45 bg-red-500/12'
                    : 'border-slate-500/35 bg-slate-500/10'
                }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white">
                  Operación Finalizada · {lastClosedTrade.symbol} ({lastClosedTrade.direction})
                </span>
                <span
                  className={`font-bold ${lastClosedTrade.status === 'WON'
                      ? 'text-emerald-400'
                      : lastClosedTrade.status === 'LOST'
                        ? 'text-red-400'
                        : lastClosedTrade.status === 'CANCELLED'
                          ? 'text-amber-300'
                          : 'text-slate-300'
                    }`}
                >
                  {lastClosedTrade.status === 'WON'
                    ? 'WIN (GANADA)'
                    : lastClosedTrade.status === 'LOST'
                      ? 'LOSS (PERDIDA)'
                      : lastClosedTrade.status === 'CANCELLED'
                        ? 'CANCELADA'
                        : 'DRAW (EMPATE)'}
                </span>
              </div>

              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <div className="text-[10px] font-sans text-slate-400">PnL Final Liquidado</div>
                  <div
                    className={`text-lg font-extrabold ${lastClosedTrade.profit > 0
                        ? 'text-emerald-400'
                        : lastClosedTrade.profit < 0
                          ? 'text-red-400'
                          : 'text-slate-300'
                      }`}
                  >
                    {lastClosedTrade.profit >= 0 ? '+' : ''}
                    {lastClosedTrade.profit.toFixed(2)} USDT
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-sans text-slate-400">Rendimiento</div>
                  <div
                    className={`text-sm font-bold ${lastClosedTrade.profit > 0
                        ? 'text-emerald-400'
                        : lastClosedTrade.profit < 0
                          ? 'text-red-400'
                          : 'text-slate-300'
                      }`}
                  >
                    {(() => {
                      const pct =
                        lastClosedTrade.return_pct !== undefined
                          ? lastClosedTrade.return_pct
                          : lastClosedTrade.amount > 0
                            ? (lastClosedTrade.profit / lastClosedTrade.amount) * 100
                            : 0;
                      return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                    })()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-white/10 text-[11px] font-mono tabular-nums">
                <div className="text-slate-400">
                  Entrada: <span className="text-white">${formatPrice(lastClosedTrade.entry_price)}</span>
                </div>
                <div className="text-right text-slate-400">
                  Cierre: <span className="text-white">${formatPrice(lastClosedTrade.close_price)}</span>
                </div>
                <div className="text-emerald-400">
                  Máx +: +${Number(lastClosedTrade.max_positive_pnl || 0).toFixed(2)}
                </div>
                <div className="text-right text-red-400">
                  Máx -: -${Math.abs(Number(lastClosedTrade.max_negative_pnl || 0)).toFixed(2)}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShareTrade({
                    symbol: lastClosedTrade.symbol,
                    direction: lastClosedTrade.direction,
                    entryPrice: lastClosedTrade.entry_price,
                    closePrice: lastClosedTrade.close_price || lastClosedTrade.entry_price,
                    profit: lastClosedTrade.profit,
                    returnPct:
                      lastClosedTrade.return_pct !== undefined
                        ? lastClosedTrade.return_pct
                        : lastClosedTrade.amount > 0
                          ? (lastClosedTrade.profit / lastClosedTrade.amount) * 100
                          : 0,
                    amount: lastClosedTrade.amount,
                    modeLabel: 'QUICK TRADING PRO',
                  })
                }
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-amber-500/20 to-cyan-500/20 hover:from-amber-500/30 hover:to-cyan-500/30 border border-amber-400/40 py-2 text-xs font-bold text-amber-200 transition-all cursor-pointer"
              >
                <Share2 className="h-3.5 w-3.5 text-amber-400" />
                <span>Compartir Operación con PnL + Referido</span>
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-[#111520] px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Duración de Operación</div>
                <div className="text-xs text-slate-300 mt-0.5">
                  {currentMarket?.symbol} · Ejecución instantánea
                </div>
              </div>
              <div className="font-mono text-2xl font-bold text-white tabular-nums">
                {formatCountdown(durationSec)}
              </div>
            </div>
          )}

          {/* Execution Controls Card */}
          <div className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-4">
            <div className="flex items-center justify-between text-xs pb-2.5 border-b border-white/8">
              <span className="text-slate-400">Saldo Disponible ({env})</span>
              <span className="font-mono font-bold text-white tabular-nums">${formatCurrency(usdtBalance)} USDT</span>
            </div>

            {/* Amount Input & Presets */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-300 font-medium">Importe de Operación (USDT)</label>
                <span className="text-[11px] font-mono text-slate-400">
                  ${qtConfig.minAmount}–${formatCurrency(qtConfig.maxAmount, 0)}
                </span>
              </div>
              <input
                type="number"
                min={qtConfig.minAmount}
                max={qtConfig.maxAmount}
                step="5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-white/12 bg-[#080B11] px-3.5 py-2.5 font-mono text-base font-semibold text-white focus:border-blue-500 focus:outline-none tabular-nums"
              />
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                {[25, 50, 100, 250].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className={`rounded-lg border py-2 min-h-[38px] text-xs font-mono transition-colors cursor-pointer ${Number(amount) === v
                        ? 'border-blue-500/60 bg-blue-500/15 text-blue-300 font-semibold'
                        : 'border-white/10 bg-[#080B11] text-slate-300 hover:bg-white/5'
                      }`}
                  >
                    ${v}
                  </button>
                ))}
              </div>
            </div>

            {/* Trade Expiration Duration Selector (Configured by Superadmin) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-300 font-medium">Duración de Operación</label>
                <span className="text-[11px] font-mono text-sky-400 tabular-nums">{formatCountdown(durationSec)}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {qtConfig.durations.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setDurationSec(sec)}
                    className={`py-2.5 min-h-[42px] rounded-lg text-xs font-mono whitespace-nowrap transition-colors cursor-pointer ${durationSec === sec
                        ? 'bg-blue-600 text-white font-semibold shadow-sm'
                        : 'bg-[#080B11] border border-white/8 text-slate-400 hover:text-white'
                      }`}
                  >
                    {formatDurationLabel(sec)}
                  </button>
                ))}
              </div>
            </div>

            {/* Transparent Payout Breakdown */}
            <div className="rounded-lg border border-white/8 bg-[#080B11] p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Payout máximo ({currentMarket?.symbol})</span>
                <span className="font-mono text-emerald-400 font-semibold">+{resolvedPayoutPct}%</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Beneficio máximo al vencimiento</span>
                <span className="font-mono text-emerald-400 font-semibold tabular-nums">
                  +${formatCurrency(potentialProfit)} USDT
                </span>
              </div>
              <div className="flex justify-between text-slate-200 pt-1 border-t border-white/6">
                <span className="font-medium">Retorno máximo posible</span>
                <span className="font-mono text-white font-bold tabular-nums">${formatCurrency(potentialReturn)} USDT</span>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
            )}

            {/* Large Ergonomic UP / DOWN Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={submitting || isConnectionStale || !qtConfig.enabled}
                onMouseEnter={() => setHoverDirection('UP')}
                onMouseLeave={() => setHoverDirection(null)}
                onClick={() => handleTrade('UP')}
                className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] min-h-[58px] py-3 px-4 text-white transition-all cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center gap-1.5 text-sm font-bold tracking-wide">
                  <TrendingUp className="h-4 w-4" />
                  <span>UP</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-100/90">ALCISTA (+{resolvedPayoutPct}%)</span>
              </button>

              <button
                type="button"
                disabled={submitting || isConnectionStale || !qtConfig.enabled}
                onMouseEnter={() => setHoverDirection('DOWN')}
                onMouseLeave={() => setHoverDirection(null)}
                onClick={() => handleTrade('DOWN')}
                className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-[0.99] min-h-[58px] py-3 px-4 text-white transition-all cursor-pointer disabled:opacity-50"
              >
                <div className="flex items-center gap-1.5 text-sm font-bold tracking-wide">
                  <TrendingDown className="h-4 w-4" />
                  <span>DOWN</span>
                </div>
                <span className="text-[10px] font-mono text-red-100/90">BAJISTA (+{resolvedPayoutPct}%)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 5 & 6: PERFORMANCE STATS & ADVANCED EXPANDABLE HISTORY */}
      <QuickTradeStatsAndHistory
        env={env}
        trades={history}
        currentBalance={usdtBalance}
        nowMs={nowMs}
        accountFilter={accountFilter}
        onAccountFilterChange={setAccountFilter}
        thermalColors={tColors}
        animationsEnabled={animOn}
      />
      <ShareTradeModal
        trade={shareTrade}
        referralCode={referralCode}
        referralRewardUsdt={referralRewardUsdt}
        onClose={() => setShareTrade(null)}
      />
    </div>
  );
}
