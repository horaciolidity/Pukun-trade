import { DEFAULT_MARKETS } from './defaultMarkets';
import { computeQuickTradeSettlement } from './utils/quickTradeMath';
import { fetchDepositGatewayConfig, recordUserTxInSupabase } from './supabase';
import type {
  AdminFutureEvent,
  AdminMissionTask,
  AdminPlatformFees,
  AdminPromoBanner,
  AppNotification,
  Candle,
  ChatMessage,
  CustomToken,
  FuturesPosition,
  LiveSignal,
  Market,
  MarketIntelItem,
  MissionClaim,
  OrderBook,
  QuickTradeItem,
  SpotOrder,
  TechnicalIndicators,
  TokenBehaviorSchedule,
  TokenMovementProfile,
  TokenTrendBias,
  TradingBot,
  TradingEnv,
  WalletItem,
  WalletTransaction,
} from './types';

const STORAGE_KEY = 'pukun_trade_vercel_state_v3';

interface WhitelistEntry {
  id: string;
  asset: string;
  network: string;
  address: string;
  label: string;
}

interface EngineState {
  markets: Market[];
  wallets: Record<TradingEnv, WalletItem[]>;
  transactions: WalletTransaction[];
  whitelist: WhitelistEntry[];
  orders: SpotOrder[];
  positions: FuturesPosition[];
  quickTrades: QuickTradeItem[];
  bots: TradingBot[];
  signals: LiveSignal[];
  analyses: MarketIntelItem[];
  tokens: CustomToken[];
  messages: ChatMessage[];
  notifications: AppNotification[];
  favorites: string[];
  fees: AdminPlatformFees;
  promoBanners: AdminPromoBanner[];
  futureEvents: AdminFutureEvent[];
  missions: AdminMissionTask[];
  missionClaims: MissionClaim[];
  referralSettings: {
    inviteRewardUsdt: number;
    firstDepositBonusPct: number;
    commissionPct: number;
    maxMonthlyRewardsUsdt: number;
  };
  config: Record<string, unknown>;
}

const BOT_TEMPLATES: TradingBot[] = [
  {
    id: 'tpl_scalp',
    env: 'DEMO',
    bot_type: 'SCALPING',
    name: 'Tiwanaku Scalper Pro',
    description: 'Captura micro-tendencias en velas de 1m con gestión automática de Stop Loss.',
    strategy_summary: 'EMA9/EMA21 + RSI intradía',
    symbol: 'BTC/USDT',
    allocated_usdt: 1000,
    risk_level: 'MEDIUM',
    status: 'PAUSED',
    config_json: '{"takeProfitPct":0.6,"stopLossPct":0.35,"interval":"1m"}',
    trades_count: 42,
    wins_count: 29,
    pnl: 142.5,
    historical_backtest_pct: 18.4,
    is_template: 1,
    created_at: Date.now() - 86400000 * 3,
  },
  {
    id: 'tpl_grid',
    env: 'DEMO',
    bot_type: 'GRID',
    name: 'Chakana Grid Bot',
    description: 'Compra en soportes y vende en resistencias de forma automática en rangos laterales.',
    strategy_summary: '12 niveles de malla automática',
    symbol: 'ETH/USDT',
    allocated_usdt: 1500,
    risk_level: 'LOW',
    status: 'PAUSED',
    config_json: '{"grids":12,"lowerPct":4,"upperPct":4}',
    trades_count: 88,
    wins_count: 65,
    pnl: 218.2,
    historical_backtest_pct: 22.1,
    is_template: 1,
    created_at: Date.now() - 86400000 * 5,
  },
  {
    id: 'tpl_dca',
    env: 'DEMO',
    bot_type: 'DCA',
    name: 'Andean DCA Accumulator',
    description: 'Promedia el precio de entrada en retrocesos para maximizar rebotes.',
    strategy_summary: '5 órdenes de seguridad escalonadas',
    symbol: 'SOL/USDT',
    allocated_usdt: 800,
    risk_level: 'LOW',
    status: 'PAUSED',
    config_json: '{"stepDropPct":2.5,"safetyOrders":5}',
    trades_count: 19,
    wins_count: 14,
    pnl: 96.4,
    historical_backtest_pct: 15.8,
    is_template: 1,
    created_at: Date.now() - 86400000 * 4,
  },
  {
    id: 'tpl_ai',
    env: 'DEMO',
    bot_type: 'AI_PREDICTIVE',
    name: 'Pukun AI Predictive',
    description: 'Motor cuantitativo impulsado por IA que evalúa momentum, volatilidad y liquidez.',
    strategy_summary: 'Confianza IA >= 72% + Trailing Stop',
    symbol: 'BTC/USDT',
    allocated_usdt: 2000,
    risk_level: 'HIGH',
    status: 'PAUSED',
    config_json: '{"confidenceThreshold":72,"maxRiskPct":2}',
    trades_count: 34,
    wins_count: 26,
    pnl: 384.9,
    historical_backtest_pct: 31.5,
    is_template: 1,
    created_at: Date.now() - 86400000 * 2,
  },
];

function createDefaultWallets(env: TradingEnv): WalletItem[] {
  const isDemo = env === 'DEMO';
  return [
    {
      asset: 'USDT',
      available: isDemo ? 10000 : 0,
      locked: 0,
      usdPrice: 1,
      usdValue: isDemo ? 10000 : 0,
      addresses: {
        'Tron (TRC-20)': 'TKPukunDemo9x82kL4mPq7vR3nW2zX1a',
        'Ethereum (ERC-20)': '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        'BNB Smart Chain': '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        Polygon: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        Arbitrum: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        Solana: 'PukunSo1ana9xK2mN8pQ4vR7wL1zX3cV5bN',
      },
    },
    {
      asset: 'BTC',
      available: isDemo ? 0.15 : 0,
      locked: 0,
      usdPrice: 91450,
      usdValue: isDemo ? 13717.5 : 0,
      addresses: { Bitcoin: 'bc1qpukun7x9k2m4n8p5q3v6r2w1z0x9c8v7b6' },
    },
    {
      asset: 'ETH',
      available: isDemo ? 1.5 : 0,
      locked: 0,
      usdPrice: 3240.5,
      usdValue: isDemo ? 4860.75 : 0,
      addresses: {
        Ethereum: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        Arbitrum: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        Base: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      },
    },
    {
      asset: 'SOL',
      available: isDemo ? 10 : 0,
      locked: 0,
      usdPrice: 214.8,
      usdValue: isDemo ? 2148 : 0,
      addresses: { Solana: 'PukunSo1ana9xK2mN8pQ4vR7wL1zX3cV5bN' },
    },
    {
      asset: 'CAIX',
      available: isDemo ? 500 : 0,
      locked: 0,
      usdPrice: 1.45,
      usdValue: isDemo ? 725 : 0,
      addresses: { Ethereum: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' },
    },
  ];
}

function createInitialState(): EngineState {
  const now = Date.now();
  return {
    markets: DEFAULT_MARKETS.map((m) => ({ ...m })),
    wallets: {
      DEMO: createDefaultWallets('DEMO'),
      REAL: createDefaultWallets('REAL'),
    },
    transactions: [],
    whitelist: [],
    orders: [],
    positions: [],
    quickTrades: [],
    bots: [],
    signals: [
      {
        id: 'sig_init_1',
        symbol: 'BTC/USDT',
        direction: 'LONG',
        category: 'TREND',
        current_price: 91450,
        entry_price: 91200,
        stop_loss: 89900,
        take_profit: 93800,
        timeframe: '15m',
        indicators: ['EMA9 > EMA21', 'RSI 56.4', 'MACD +'],
        confidence: 82,
        generator_bot: 'PUKUN_QUANT_AI',
        outcome: 'ACTIVE',
        created_at: now - 600000,
      },
      {
        id: 'sig_init_2',
        symbol: 'SOL/USDT',
        direction: 'LONG',
        category: 'BREAKOUT',
        current_price: 214.8,
        entry_price: 213.5,
        stop_loss: 207.8,
        take_profit: 224.0,
        timeframe: '1h',
        indicators: ['BB Breakout', 'Vol +42%', 'SMA20 Support'],
        confidence: 78,
        generator_bot: 'PUKUN_QUANT_AI',
        outcome: 'ACTIVE',
        created_at: now - 1800000,
      },
    ],
    analyses: [],
    tokens: [
      {
        id: 'tok_caix',
        name: 'Pukun Ancestral Token',
        symbol: 'CAIX',
        logo_color: '#f59e0b',
        description: 'Token nativo del ecosistema Pukun Trade para descuentos en comisiones y gobernanza.',
        blockchain: 'Ethereum',
        standard: 'ERC-20',
        total_supply: 100000000,
        initial_supply: 25000000,
        max_supply: 100000000,
        decimals: 18,
        is_variable: 0,
        mintable: 0,
        burnable: 1,
        pausable: 0,
        tokenomics: [
          { label: 'Comunidad & Referidos', pct: 40, vesting: 'Lineal 24m' },
          { label: 'Liquidez Exchange', pct: 25, vesting: 'Bloqueado 12m' },
          { label: 'Tesorería', pct: 20, vesting: 'Cliff 6m' },
          { label: 'Equipo', pct: 15, vesting: 'Cliff 12m' },
        ],
        utilities: { feeDiscount: true, staking: true, governance: true, launchpadAccess: true },
        contract_address: '0xPukun00000000000000000000000000CAIX2026',
        audit_status: 'VERIFIED',
        deploy_stage: 'LISTED',
        listed_on_exchange: 1,
        launchpad_status: 'ACTIVE',
        initial_price_usdt: 1.45,
        movement_profile: 'NORMAL',
        movement_schedules: [
          { id: 'sch_1', startTime: '00:00', endTime: '08:00', profile: 'CALM', bias: 'NEUTRAL', label: 'Sesión Asiática Tranquila' },
          { id: 'sch_2', startTime: '08:00', endTime: '17:00', profile: 'NORMAL', bias: 'BULLISH', label: 'Apertura Mercado Global' },
          { id: 'sch_3', startTime: '17:00', endTime: '23:59', profile: 'VOLATILE', bias: 'NEUTRAL', label: 'Alta Volatilidad Nocturna' },
        ],
        created_at: now - 86400000 * 10,
      },
    ],
    messages: [
      {
        id: 'msg_welcome',
        room: 'general',
        user_id: 'system',
        author_name: 'Pukun Trade Bot',
        author_role: 'SUPERADMIN',
        content:
          '¡Bienvenidos a la comunidad oficial de Pukun Trade! Comparte análisis, estrategias y tu enlace de referido para ganar 40 USDT.',
        attachment_json: '{}',
        pinned: 1,
        reported: 0,
        created_at: now - 3600000,
      },
    ],
    notifications: [
      {
        id: 'notif_welcome',
        title: 'Bienvenido a Pukun Trade',
        message: 'Tu entorno DEMO está activo con 10.000 USDT virtuales. ¡Comparte tu referido y gana 40 USDT!',
        category: 'SYSTEM',
        read: 0,
        created_at: now,
      },
    ],
    favorites: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    fees: {
      spotMakerPct: 0.08,
      spotTakerPct: 0.1,
      futuresFeePct: 0.05,
      withdrawFeeUsdt: 1.5,
      withdrawFeePct: 0.1,
    },
    promoBanners: [
      {
        id: 'promo_ref_40',
        badge: 'EVENTO OFICIAL · REFERIDOS',
        title: '¡Gana 40 USDT por cada amigo que invites!',
        subtitle: 'Comparte tu código Pukun Trade y recibe recompensas automáticas en tu billetera.',
        ctaText: 'Ir a Referidos',
        targetTab: 'referrals',
        imageUrl: '/og-ref-40usdt.jpg',
        active: true,
        createdAt: now,
      },
    ],
    futureEvents: [
      {
        id: 'evt_tiwanaku_cup',
        title: 'Gran Copa Tiwanaku Trading 2026',
        rewardUsdt: 5000,
        startDate: '2026-12-01',
        endDate: '2026-12-31',
        description: 'Torneo mensual de rentabilidad en Futuros y Quick Trading con premios en USDT para el Top 20.',
        active: true,
      },
    ],
    missions: [
      {
        id: 'mis_tg',
        platform: 'TELEGRAM',
        title: 'Únete a nuestro Canal Oficial de Telegram',
        description: 'Recibe señales, sorteos semanales y anuncios exclusivos de Pukun Trade.',
        rewardUsdt: 2,
        rewardAsset: 'USDT',
        actionUrl: 'https://t.me/pukuntrade',
        requiresProof: false,
        bannerImageUrl: '/banner-bots.jpg',
        active: true,
        createdAt: now,
      },
      {
        id: 'mis_yt',
        platform: 'YOUTUBE',
        title: 'Suscríbete al canal de YouTube de Pukun Trade',
        description: 'Aprende estrategias de Futuros 125x, Bots IA y Quick Trading.',
        rewardUsdt: 2,
        rewardAsset: 'USDT',
        actionUrl: 'https://youtube.com/@pukuntrade',
        requiresProof: false,
        bannerImageUrl: '/banner-trading.jpg',
        active: true,
        createdAt: now,
      },
      {
        id: 'mis_x',
        platform: 'X',
        title: 'Síguenos en X (Twitter) y repostea el post fijado',
        description: 'Mantente al día con noticias cripto y eventos relámpago.',
        rewardUsdt: 2,
        rewardAsset: 'USDT',
        actionUrl: 'https://x.com/pukuntrade',
        requiresProof: false,
        bannerImageUrl: '/banner-launchpad.jpg',
        active: true,
        createdAt: now,
      },
      {
        id: 'mis_ig',
        platform: 'INSTAGRAM',
        title: 'Síguenos en Instagram @pukuntrade',
        description: 'Comparte tus tarjetas de PnL etiquetándonos en historias.',
        rewardUsdt: 2,
        rewardAsset: 'USDT',
        actionUrl: 'https://instagram.com/pukuntrade',
        requiresProof: false,
        bannerImageUrl: '/patagonia-sunset-bg.jpg',
        active: true,
        createdAt: now,
      },
      {
        id: 'mis_tiktok',
        platform: 'TIKTOK',
        title: 'Crea un TikTok de Pukun Trade con tu código referido',
        description: 'Graba un video mostrando Quick Trade o Futuros con tu enlace de referido y gana cripto.',
        rewardUsdt: 15,
        rewardAsset: 'USDT',
        actionUrl: 'https://tiktok.com',
        requiresProof: true,
        bannerImageUrl: '/og-ref-40usdt.jpg',
        active: true,
        createdAt: now,
      },
      {
        id: 'mis_ref_bonus',
        platform: 'REFERRAL',
        title: 'Invita amigos con tu enlace y gana 40 USDT',
        description: 'Comparte tu código único: cada referido activo suma recompensas directas + 20% de comisiones.',
        rewardUsdt: 40,
        rewardAsset: 'USDT',
        actionUrl: '',
        requiresProof: false,
        bannerImageUrl: '/og-ref-40usdt.jpg',
        active: true,
        createdAt: now,
      },
    ],
    missionClaims: [],
    referralSettings: {
      inviteRewardUsdt: 40,
      firstDepositBonusPct: 10,
      commissionPct: 20,
      maxMonthlyRewardsUsdt: 2500,
    },
    config: {
      branding: {
        name: 'PUKUN TRADE',
        defaultCurrency: 'USDT',
        defaultLanguage: 'es',
        announcement: '¡Gana 40 USDT por cada referido verificado!',
      },
      demo_settings: {
        initialCapital: 10000,
        feeBps: 10,
        spreadBps: 4,
        slippageBps: 2,
        maxLeverage: 125,
        allowTopup: true,
      },
      quickTrading: {
        minAmount: 5,
        maxAmount: 5000,
        allowedDurations: [15, 30, 60, 180, 300],
        defaultPayoutPct: 85,
        payoutByDuration: { 15: 82, 30: 85, 60: 87, 180: 90, 300: 92 },
        allowCancelBeforeSec: 5,
      },
      enabled_modules: {},
    },
  };
}

function loadState(): EngineState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const init = createInitialState();
      saveState(init);
      return init;
    }
    const parsed = JSON.parse(raw) as Partial<EngineState>;
    const base = createInitialState();
    return {
      ...base,
      ...parsed,
      wallets: parsed.wallets?.DEMO ? parsed.wallets : base.wallets,
      markets: Array.isArray(parsed.markets) && parsed.markets.length > 0 ? parsed.markets : base.markets,
    };
  } catch {
    return createInitialState();
  }
}

function saveState(state: EngineState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveActiveBehavior(token: CustomToken): { profile: TokenMovementProfile; bias: TokenTrendBias } {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const schedules: TokenBehaviorSchedule[] = Array.isArray(token.movement_schedules) ? token.movement_schedules : [];
  for (const sch of schedules) {
    if (sch.startTime <= sch.endTime) {
      if (hhmm >= sch.startTime && hhmm <= sch.endTime) {
        return { profile: sch.profile, bias: sch.bias };
      }
    } else {
      // overnight schedule (e.g. 22:00 - 04:00)
      if (hhmm >= sch.startTime || hhmm <= sch.endTime) {
        return { profile: sch.profile, bias: sch.bias };
      }
    }
  }
  return { profile: token.movement_profile || 'NORMAL', bias: 'NEUTRAL' };
}

export function computeCustomTokenNextPrice(symbol: string): number | null {
  const state = loadState();
  const base = symbol.split('/')[0];
  const tok = state.tokens.find((t) => t.symbol.toUpperCase() === base.toUpperCase());
  const mkt = state.markets.find((m) => m.symbol === symbol);
  if (!tok || !mkt) return null;

  const { profile, bias } = resolveActiveBehavior(tok);
  const volMap: Record<TokenMovementProfile, number> = {
    STABLECOIN: 0.00025,
    CALM: 0.0009,
    NORMAL: 0.0024,
    VOLATILE: 0.0078,
  };
  const biasMap: Record<TokenTrendBias, number> = {
    NEUTRAL: 0,
    BULLISH: 0.00045,
    BEARISH: -0.00045,
  };

  const vol = volMap[profile] ?? 0.0024;
  const drift = biasMap[bias] ?? 0;
  let next = mkt.last_price * (1 + drift + (Math.random() - 0.5) * 2 * vol);

  if (profile === 'STABLECOIN') {
    const peg = tok.initial_price_usdt || 1;
    next = peg + (next - peg) * 0.35;
  } else {
    next = Math.max(tok.initial_price_usdt * 0.15, next);
  }

  mkt.last_price = Number(next.toFixed(next > 10 ? 2 : 5));
  mkt.high_24h = Math.max(mkt.high_24h, mkt.last_price);
  mkt.low_24h = Math.min(mkt.low_24h, mkt.last_price);
  saveState(state);
  return mkt.last_price;
}

async function getLivePrice(symbol: string, state: EngineState): Promise<number> {
  const m = state.markets.find((x) => x.symbol === symbol);
  if (m?.is_custom_token === 1) {
    const simulated = computeCustomTokenNextPrice(symbol);
    if (simulated !== null) return simulated;
  }
  const clean = symbol.replace('/', '').toUpperCase();
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(clean)}`);
    if (res.ok) {
      const data = (await res.json()) as { price?: string };
      const p = parseFloat(data.price || '');
      if (Number.isFinite(p) && p > 0) {
        if (m) m.last_price = p;
        return p;
      }
    }
  } catch {
    // fallback to stored price
  }
  return m?.last_price || 100;
}

function getOrCreateWallet(state: EngineState, env: TradingEnv, asset: string, usdPrice = 1): WalletItem {
  let w = state.wallets[env].find((x) => x.asset === asset);
  if (!w) {
    w = { asset, available: 0, locked: 0, usdPrice, usdValue: 0, addresses: {} };
    state.wallets[env].push(w);
  }
  return w;
}

function computeWalletSummary(state: EngineState, env: TradingEnv) {
  let totalUsdt = 0;
  let availableUsdt = 0;
  let lockedUsdt = 0;
  for (const w of state.wallets[env]) {
    const mkt = state.markets.find((m) => m.base === w.asset && m.quote === 'USDT');
    const price = w.asset === 'USDT' ? 1 : mkt?.last_price || w.usdPrice || 1;
    w.usdPrice = price;
    w.usdValue = Number(((w.available + w.locked) * price).toFixed(2));
    totalUsdt += w.usdValue;
    availableUsdt += w.available * price;
    lockedUsdt += w.locked * price;
  }
  return {
    totalUsdt: Number(totalUsdt.toFixed(2)),
    availableUsdt: Number(availableUsdt.toFixed(2)),
    lockedUsdt: Number(lockedUsdt.toFixed(2)),
  };
}

async function settleExpiredQuickTrades(state: EngineState, priceHint?: { symbol: string; price: number }) {
  const now = Date.now();
  let changed = false;
  for (const qt of state.quickTrades) {
    if (qt.status === 'ACTIVE' && now >= qt.expires_at) {
      const live =
        priceHint && priceHint.symbol === qt.symbol && priceHint.price > 0
          ? priceHint.price
          : await getLivePrice(qt.symbol, state);
      const finalPrice =
        live === qt.entry_price ? live * (Math.random() > 0.48 ? 1.00025 : 0.99975) : live;

      const settlement = computeQuickTradeSettlement({
        direction: qt.direction,
        amount: qt.amount,
        entryPrice: qt.entry_price,
        closePrice: finalPrice,
        payoutPct: qt.payout_pct,
        createdAt: qt.created_at,
        expiresAt: qt.expires_at,
        settledAt: now,
      });

      qt.close_price = Number(finalPrice.toFixed(6));
      qt.closed_at = now;
      qt.status = settlement.status;
      qt.profit = settlement.profit;
      qt.return_pct = settlement.returnPct;

      // Credit back exact returnAmount (stake + profit; on partial loss, returns remaining uncompromised stake!)
      if (settlement.returnAmount > 0) {
        const usdtW = getOrCreateWallet(state, qt.env, 'USDT', 1);
        usdtW.available = Number((usdtW.available + settlement.returnAmount).toFixed(4));
      }
      changed = true;
    }
  }
  if (changed) saveState(state);
}

export async function fetchBinanceChartFallback(base: string, quote: string, tf: string) {
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
    // fallback below
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

export async function handleVercelApiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : {};
  const [pathname, queryStr = ''] = url.split('?');
  const params = new URLSearchParams(queryStr);
  const envParam = (params.get('env') === 'REAL' ? 'REAL' : 'DEMO') as TradingEnv;
  const state = loadState();

  // 1. Health & Public Bootstrap
  if (pathname === '/api/health') {
    return { ok: true, mode: 'vercel-supabase' } as unknown as T;
  }
  if (pathname === '/api/markets' && method === 'GET') {
    return { markets: state.markets } as unknown as T;
  }
  if (pathname === '/api/bootstrap' && method === 'GET') {
    return {
      branding: (state.config.branding as Record<string, unknown>) || { name: 'PUKUN TRADE' },
      modules: (state.config.enabled_modules as Record<string, boolean>) || {},
      fees: state.fees,
      promoBanners: state.promoBanners,
      futureEvents: state.futureEvents,
      missions: state.missions,
      referralSettings: state.referralSettings,
    } as unknown as T;
  }
  if (pathname === '/api/missions' && method === 'GET') {
    return {
      missions: state.missions.filter((m) => m.active),
      claims: state.missionClaims,
    } as unknown as T;
  }
  if (pathname === '/api/missions/claim' && method === 'POST') {
    const missionId = String(body.missionId || '');
    const proofUrl = String(body.proofUrl || '').trim();
    const mission = state.missions.find((m) => m.id === missionId);
    if (!mission) throw new Error('Misión no encontrada.');
    if (state.missionClaims.some((c) => c.missionId === missionId)) {
      throw new Error('Ya reclamaste o enviaste esta misión.');
    }
    if (mission.requiresProof && !proofUrl) {
      throw new Error('Pega el enlace de tu publicación (ej. TikTok/YouTube) para validar el premio.');
    }
    const claim: MissionClaim = {
      id: uid('clm'),
      missionId,
      proofUrl,
      status: mission.requiresProof ? 'PENDING_REVIEW' : 'COMPLETED',
      rewardUsdt: mission.rewardUsdt,
      createdAt: Date.now(),
    };
    state.missionClaims.unshift(claim);
    if (claim.status === 'COMPLETED') {
      const w = getOrCreateWallet(state, 'DEMO', mission.rewardAsset || 'USDT', 1);
      w.available = Number((w.available + mission.rewardUsdt).toFixed(2));
    }
    saveState(state);
    return { claim } as unknown as T;
  }
  if (pathname === '/api/markets/favorite' && method === 'POST') {
    const sym = String(body.symbol || '');
    if (sym) {
      if (state.favorites.includes(sym)) state.favorites = state.favorites.filter((s) => s !== sym);
      else state.favorites.push(sym);
      saveState(state);
    }
    return { favorites: state.favorites } as unknown as T;
  }

  // 2. Charts (Real Binance Klines)
  const chartMatch = pathname.match(/^\/api\/markets\/([^/]+)\/([^/]+)\/chart$/);
  if (chartMatch && method === 'GET') {
    const base = decodeURIComponent(chartMatch[1]);
    const quote = decodeURIComponent(chartMatch[2]);
    const tf = params.get('tf') || '1m';
    return (await fetchBinanceChartFallback(base, quote, tf)) as unknown as T;
  }

  // 3. Wallets & Demo Controls
  if (pathname === '/api/wallet' && method === 'GET') {
    const summary = computeWalletSummary(state, envParam);
    const depCfg = await fetchDepositGatewayConfig();
    const walletsWithMaster = state.wallets[envParam].map((w) => {
      const mergedAddresses: Record<string, string> = { ...w.addresses };
      for (const [net, addr] of Object.entries(depCfg.masterAddresses || {})) {
        if (addr && addr.trim()) {
          if (w.asset === 'USDT' && (net.includes('Tron') || net.includes('BNB') || net.includes('Ethereum') || net.includes('Polygon') || net.includes('Arbitrum') || net.includes('Solana'))) {
            mergedAddresses[net] = addr.trim();
          } else if (w.asset === 'BTC' && net === 'Bitcoin') {
            mergedAddresses[net] = addr.trim();
          } else if (w.asset === 'ETH' && (net.includes('Ethereum') || net.includes('Arbitrum'))) {
            mergedAddresses[net] = addr.trim();
          } else if (w.asset === 'SOL' && net === 'Solana') {
            mergedAddresses[net] = addr.trim();
          }
        }
      }
      return { ...w, addresses: mergedAddresses };
    });
    saveState(state);
    return {
      wallets: walletsWithMaster,
      summary,
      transactions: state.transactions.filter((t) => t.env === envParam),
      whitelist: state.whitelist,
    } as unknown as T;
  }
  if (pathname === '/api/wallet/demo/reset' && method === 'POST') {
    state.wallets.DEMO = createDefaultWallets('DEMO');
    state.orders = state.orders.filter((o) => o.env !== 'DEMO');
    state.positions = state.positions.filter((p) => p.env !== 'DEMO');
    state.quickTrades = state.quickTrades.filter((q) => q.env !== 'DEMO');
    saveState(state);
    return { initialUsdt: 10000 } as unknown as T;
  }
  if (pathname === '/api/wallet/demo/topup' && method === 'POST') {
    const amt = Math.max(100, Number(body.amount || 2500));
    const w = getOrCreateWallet(state, 'DEMO', 'USDT', 1);
    w.available = Number((w.available + amt).toFixed(2));
    state.transactions.unshift({
      id: uid('tx'),
      env: 'DEMO',
      type: 'DEPOSIT',
      asset: 'USDT',
      network: 'DEMO_FAUCET',
      amount: amt,
      fee: 0,
      address: 'DEMO_INTERNAL',
      txid: uid('demo'),
      status: 'COMPLETED',
      created_at: Date.now(),
    });
    saveState(state);
    return { ok: true, available: w.available } as unknown as T;
  }
  if (pathname === '/api/wallet/deposit' && method === 'POST') {
    const targetEnv: TradingEnv = body.env === 'REAL' ? 'REAL' : 'DEMO';
    const asset = String(body.asset || 'USDT');
    const amount = Number(body.amount || 0);
    if (amount <= 0) throw new Error('Ingresa un monto válido.');
    const status = targetEnv === 'DEMO' ? 'COMPLETED' : 'PENDING';
    if (targetEnv === 'DEMO') {
      const w = getOrCreateWallet(state, 'DEMO', asset);
      w.available = Number((w.available + amount).toFixed(6));
    }
    const txid = String(body.txid || uid('txid'));
    state.transactions.unshift({
      id: uid('tx'),
      env: targetEnv,
      type: 'DEPOSIT',
      asset,
      network: String(body.network || 'Tron (TRC-20)'),
      amount,
      fee: 0,
      address: String(body.address || ''),
      txid,
      status,
      created_at: Date.now(),
    });
    await recordUserTxInSupabase({
      env: targetEnv,
      type: 'DEPOSIT',
      asset,
      network: String(body.network || 'Tron (TRC-20)'),
      amount,
      txid,
      address: String(body.address || ''),
      status,
    });
    saveState(state);
    return {
      status,
      txid,
      message: targetEnv === 'DEMO' ? 'Depósito DEMO acreditado.' : 'Depósito registrado para conciliación.',
    } as unknown as T;
  }
  if (pathname === '/api/wallet/withdraw' && method === 'POST') {
    const targetEnv: TradingEnv = body.env === 'REAL' ? 'REAL' : 'DEMO';
    if (targetEnv === 'DEMO') {
      throw new Error('Los retiros están bloqueados en entorno DEMO (dinero virtual).');
    }
    const asset = String(body.asset || 'USDT');
    const amount = Number(body.amount || 0);
    const w = getOrCreateWallet(state, 'REAL', asset);
    if (amount <= 0 || w.available < amount) throw new Error('Saldo REAL insuficiente.');
    w.available = Number((w.available - amount).toFixed(6));
    state.transactions.unshift({
      id: uid('tx'),
      env: 'REAL',
      type: 'WITHDRAW',
      asset,
      network: String(body.network || 'Tron (TRC-20)'),
      amount,
      fee: 1,
      address: String(body.address || ''),
      txid: '',
      status: 'PENDING',
      created_at: Date.now(),
    });
    saveState(state);
    return { status: 'PENDING' } as unknown as T;
  }
  if (pathname === '/api/wallet/whitelist' && method === 'POST') {
    state.whitelist.unshift({
      id: uid('wl'),
      asset: String(body.asset || 'USDT'),
      network: String(body.network || 'Tron (TRC-20)'),
      address: String(body.address || ''),
      label: String(body.label || 'Mi Wallet'),
    });
    saveState(state);
    return { ok: true } as unknown as T;
  }

  // 4. Spot Trading (Open & Cancel)
  if (pathname === '/api/spot/orders' && method === 'GET') {
    return { orders: state.orders.filter((o) => o.env === envParam) } as unknown as T;
  }
  if (pathname === '/api/spot/order' && method === 'POST') {
    const targetEnv: TradingEnv = body.env === 'REAL' ? 'REAL' : 'DEMO';
    const symbol = String(body.symbol || 'BTC/USDT');
    const [base, quote = 'USDT'] = symbol.split('/');
    const side: 'BUY' | 'SELL' = body.side === 'SELL' ? 'SELL' : 'BUY';
    const orderType = String(body.orderType || body.type || 'MARKET');
    const qty = Number(body.qty || 0);
    if (qty <= 0) throw new Error('Cantidad inválida.');

    const livePrice = await getLivePrice(symbol, state);
    const executedPrice = orderType === 'MARKET' ? livePrice : Number(body.price || livePrice);
    const totalUsdt = qty * executedPrice;
    const feePct = orderType === 'MARKET' ? (state.fees.spotTakerPct || 0.1) : (state.fees.spotMakerPct || 0.08);
    const fee = Number(((totalUsdt * feePct) / 100).toFixed(4));

    const usdtWallet = getOrCreateWallet(state, targetEnv, quote, 1);
    const baseWallet = getOrCreateWallet(state, targetEnv, base, livePrice);

    if (side === 'BUY') {
      if (usdtWallet.available < totalUsdt + fee) {
        throw new Error(`Saldo insuficiente en ${quote} (necesitas $${(totalUsdt + fee).toFixed(2)}).`);
      }
      if (orderType === 'MARKET') {
        usdtWallet.available = Number((usdtWallet.available - totalUsdt - fee).toFixed(6));
        baseWallet.available = Number((baseWallet.available + qty).toFixed(6));
      } else {
        usdtWallet.available = Number((usdtWallet.available - totalUsdt).toFixed(6));
        usdtWallet.locked = Number((usdtWallet.locked + totalUsdt).toFixed(6));
      }
    } else {
      if (baseWallet.available < qty) {
        throw new Error(`Saldo insuficiente en ${base} (disponible: ${baseWallet.available}).`);
      }
      if (orderType === 'MARKET') {
        baseWallet.available = Number((baseWallet.available - qty).toFixed(6));
        usdtWallet.available = Number((usdtWallet.available + totalUsdt - fee).toFixed(6));
      } else {
        baseWallet.available = Number((baseWallet.available - qty).toFixed(6));
        baseWallet.locked = Number((baseWallet.locked + qty).toFixed(6));
      }
    }

    const order: SpotOrder = {
      id: uid('ord'),
      env: targetEnv,
      market_symbol: symbol,
      side,
      type: orderType,
      price: executedPrice,
      stop_price: Number(body.stopPrice || 0),
      qty,
      filled_qty: orderType === 'MARKET' ? qty : 0,
      fee,
      fee_asset: quote,
      status: orderType === 'MARKET' ? 'FILLED' : 'OPEN',
      created_at: Date.now(),
    };
    state.orders.unshift(order);
    saveState(state);
    return { executedPrice, fee, order } as unknown as T;
  }
  const delOrderMatch = pathname.match(/^\/api\/spot\/orders\/([^/]+)$/);
  if (delOrderMatch && method === 'DELETE') {
    const id = delOrderMatch[1];
    const ord = state.orders.find((o) => o.id === id);
    if (ord && ord.status === 'OPEN') {
      ord.status = 'CANCELLED';
      const [base, quote = 'USDT'] = ord.market_symbol.split('/');
      if (ord.side === 'BUY') {
        const uw = getOrCreateWallet(state, ord.env, quote, 1);
        const rel = ord.price * ord.qty;
        uw.locked = Math.max(0, Number((uw.locked - rel).toFixed(6)));
        uw.available = Number((uw.available + rel).toFixed(6));
      } else {
        const bw = getOrCreateWallet(state, ord.env, base);
        bw.locked = Math.max(0, Number((bw.locked - ord.qty).toFixed(6)));
        bw.available = Number((bw.available + ord.qty).toFixed(6));
      }
      saveState(state);
    }
    return { ok: true } as unknown as T;
  }

  // 5. Futures 125x (Open & Close)
  if (pathname === '/api/futures/positions' && method === 'GET') {
    return { positions: state.positions.filter((p) => p.env === envParam) } as unknown as T;
  }
  if (pathname === '/api/futures/open' && method === 'POST') {
    const targetEnv: TradingEnv = body.env === 'REAL' ? 'REAL' : 'DEMO';
    const symbol = String(body.symbol || 'BTC/USDT');
    const side: 'LONG' | 'SHORT' = body.side === 'SHORT' ? 'SHORT' : 'LONG';
    const leverage = Math.max(1, Math.min(125, Number(body.leverage || 10)));
    const marginMode: 'ISOLATED' | 'CROSS' = body.marginMode === 'CROSS' ? 'CROSS' : 'ISOLATED';
    const marginVal = Number(body.marginUsdt || body.margin || 0);
    if (marginVal <= 0) throw new Error('Ingresa un margen válido.');

    const usdtW = getOrCreateWallet(state, targetEnv, 'USDT', 1);
    if (usdtW.available < marginVal) {
      throw new Error(`Saldo USDT insuficiente (disponible: $${usdtW.available.toFixed(2)}).`);
    }

    const entryPrice = await getLivePrice(symbol, state);
    const notional = marginVal * leverage;
    const qty = Number((notional / entryPrice).toFixed(6));
    const liqFactor = 0.9 / leverage;
    const liqPrice = Number(
      (side === 'LONG' ? entryPrice * (1 - liqFactor) : entryPrice * (1 + liqFactor)).toFixed(entryPrice > 10 ? 2 : 5)
    );

    usdtW.available = Number((usdtW.available - marginVal).toFixed(4));
    usdtW.locked = Number((usdtW.locked + marginVal).toFixed(4));

    const pos: FuturesPosition = {
      id: uid('fut'),
      env: targetEnv,
      market_symbol: symbol,
      side,
      margin_mode: marginMode,
      leverage,
      entry_price: entryPrice,
      qty,
      margin: marginVal,
      liq_price: Math.max(0.0001, liqPrice),
      stop_loss: Number(body.slPrice || body.stopLoss || 0),
      take_profit: Number(body.tpPrice || body.takeProfit || 0),
      realized_pnl: 0,
      funding_paid: 0,
      status: 'OPEN',
      created_at: Date.now(),
      closed_at: 0,
    };
    state.positions.unshift(pos);
    saveState(state);
    return { entryPrice, liqPrice: pos.liq_price, position: pos } as unknown as T;
  }
  const closeFutMatch = pathname.match(/^\/api\/futures\/([^/]+)\/close$/);
  if (closeFutMatch && method === 'POST') {
    const id = closeFutMatch[1];
    const pos = state.positions.find((p) => p.id === id);
    if (!pos || pos.status !== 'OPEN') throw new Error('Posición no encontrada o ya cerrada.');
    const exitPrice = await getLivePrice(pos.market_symbol, state);
    const rawPnl =
      pos.side === 'LONG' ? (exitPrice - pos.entry_price) * pos.qty : (pos.entry_price - exitPrice) * pos.qty;
    const pnl = Number(Math.max(-pos.margin, rawPnl).toFixed(2));
    pos.realized_pnl = pnl;
    pos.status = 'CLOSED';
    pos.closed_at = Date.now();

    const usdtW = getOrCreateWallet(state, pos.env, 'USDT', 1);
    usdtW.locked = Math.max(0, Number((usdtW.locked - pos.margin).toFixed(4)));
    usdtW.available = Number((usdtW.available + Math.max(0, pos.margin + pnl)).toFixed(4));
    saveState(state);
    return { pnl } as unknown as T;
  }

  // 6. Quick Trading Pro (History, Open, Cancel & Auto-Settle)
  if (pathname === '/api/quick-trade/history' && method === 'GET') {
    const hintSym = params.get('sym') || '';
    const hintPrice = Number(params.get('price') || 0);
    await settleExpiredQuickTrades(
      state,
      hintSym && hintPrice > 0 ? { symbol: hintSym, price: hintPrice } : undefined
    );
    return {
      trades: state.quickTrades.filter((t) => t.env === envParam),
      config: state.config.quickTrading,
    } as unknown as T;
  }
  if (pathname === '/api/quick-trade/open' && method === 'POST') {
    const targetEnv: TradingEnv = body.env === 'REAL' ? 'REAL' : 'DEMO';
    const symbol = String(body.symbol || 'BTC/USDT');
    const direction: 'UP' | 'DOWN' = body.direction === 'DOWN' ? 'DOWN' : 'UP';
    const amountVal = Number(body.amountUsdt || body.amount || 0);
    const durationSec = Number(body.durationSec || body.duration || 30);
    if (amountVal < 5) throw new Error('El monto mínimo en Quick Trading es 5 USDT.');

    const usdtW = getOrCreateWallet(state, targetEnv, 'USDT', 1);
    if (usdtW.available < amountVal) {
      throw new Error(`Saldo USDT insuficiente (disponible: $${usdtW.available.toFixed(2)}).`);
    }

    const entryPrice = await getLivePrice(symbol, state);
    const payoutMap: Record<number, number> = { 15: 82, 30: 85, 60: 87, 180: 90, 300: 92 };
    const payoutPct = payoutMap[durationSec] || 85;
    const now = Date.now();

    usdtW.available = Number((usdtW.available - amountVal).toFixed(4));
    const trade: QuickTradeItem = {
      id: uid('qt'),
      env: targetEnv,
      symbol,
      direction,
      amount: amountVal,
      duration_sec: durationSec,
      entry_price: entryPrice,
      close_price: 0,
      payout_pct: payoutPct,
      status: 'ACTIVE',
      profit: 0,
      expires_at: now + durationSec * 1000,
      created_at: now,
      price_source: 'BINANCE_LIVE',
    };
    state.quickTrades.unshift(trade);
    saveState(state);
    return { trade } as unknown as T;
  }
  const cancelQtMatch = pathname.match(/^\/api\/quick-trade\/([^/]+)\/cancel$/);
  if (cancelQtMatch && method === 'POST') {
    const id = cancelQtMatch[1];
    const qt = state.quickTrades.find((t) => t.id === id);
    if (!qt || qt.status !== 'ACTIVE') throw new Error('Operación no cancelable.');
    qt.status = 'CANCELLED';
    qt.closed_at = Date.now();
    qt.cancel_reason = 'Cancelado por el usuario';
    const usdtW = getOrCreateWallet(state, qt.env, 'USDT', 1);
    usdtW.available = Number((usdtW.available + qt.amount).toFixed(4));
    saveState(state);
    return { ok: true } as unknown as T;
  }

  // 7. AI Trading Bots
  if (pathname === '/api/bots' && method === 'GET') {
    return {
      bots: state.bots.filter((b) => b.env === envParam),
      templates: BOT_TEMPLATES,
    } as unknown as T;
  }
  if (pathname === '/api/bots/create' && method === 'POST') {
    const targetEnv: TradingEnv = body.env === 'REAL' ? 'REAL' : 'DEMO';
    const bot: TradingBot = {
      id: uid('bot'),
      env: targetEnv,
      bot_type: String(body.botType || body.bot_type || 'SCALPING'),
      name: String(body.name || 'Pukun AI Bot'),
      description: String(body.description || 'Estrategia algorítmica activa en Pukun Trade.'),
      strategy_summary: String(body.strategySummary || 'Ejecución automatizada'),
      symbol: String(body.symbol || body.market_symbol || 'BTC/USDT'),
      allocated_usdt: Number(body.allocatedUsdt || body.budgetUsdt || 500),
      risk_level: String(body.riskLevel || 'MEDIUM'),
      status: 'ACTIVE',
      config_json: JSON.stringify(body.config || {}),
      trades_count: Math.floor(3 + Math.random() * 10),
      wins_count: Math.floor(2 + Math.random() * 7),
      pnl: Number((Math.random() * 25).toFixed(2)),
      historical_backtest_pct: 19.5,
      is_template: 0,
      created_at: Date.now(),
    };
    state.bots.unshift(bot);
    saveState(state);
    return { bot } as unknown as T;
  }
  const botMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (botMatch) {
    const id = botMatch[1];
    if (method === 'DELETE') {
      state.bots = state.bots.filter((b) => b.id !== id);
      saveState(state);
      return { ok: true } as unknown as T;
    }
    const bot = state.bots.find((b) => b.id === id);
    if (bot) {
      if (body.status) bot.status = body.status;
      if (body.allocatedUsdt || body.budgetUsdt) bot.allocated_usdt = Number(body.allocatedUsdt || body.budgetUsdt);
      if (body.config) bot.config_json = JSON.stringify(body.config);
      saveState(state);
    }
    return { bot } as unknown as T;
  }

  // 8. Signals & Market Intel AI
  if (pathname === '/api/signals' && method === 'GET') {
    return { signals: state.signals } as unknown as T;
  }
  if (pathname === '/api/signals/generate' && method === 'POST') {
    const symbol = String(body.symbol || 'BTC/USDT');
    const tf = String(body.timeframe || '15m');
    const lp = await getLivePrice(symbol, state);
    const bullish = Math.random() >= 0.42;
    const sig: LiveSignal = {
      id: uid('sig'),
      symbol,
      direction: bullish ? 'LONG' : 'SHORT',
      category: bullish ? 'MOMENTUM' : 'REVERSAL',
      current_price: lp,
      entry_price: lp,
      stop_loss: Number((lp * (bullish ? 0.988 : 1.012)).toFixed(lp > 10 ? 2 : 5)),
      take_profit: Number((lp * (bullish ? 1.024 : 0.976)).toFixed(lp > 10 ? 2 : 5)),
      timeframe: tf,
      indicators: bullish ? ['EMA9 > EMA21', 'RSI 58', 'Volumen Alto'] : ['Resistencia Clave', 'RSI 71', 'Divergencia'],
      confidence: Math.floor(72 + Math.random() * 18),
      generator_bot: 'PUKUN_QUANT_AI',
      outcome: 'ACTIVE',
      created_at: Date.now(),
    };
    state.signals.unshift(sig);
    saveState(state);
    return { signal: sig } as unknown as T;
  }
  if (pathname === '/api/ai/intel' && method === 'GET') {
    return { analyses: state.analyses } as unknown as T;
  }
  if (pathname === '/api/ai/analyze' && method === 'POST') {
    const symbol = String(body.symbol || 'BTC/USDT');
    const timeframe = String(body.timeframe || '1H');
    const lp = await getLivePrice(symbol, state);
    const bull = Math.floor(42 + Math.random() * 26);
    const bear = Math.floor(15 + Math.random() * 20);
    const side = Math.max(0, 100 - bull - bear);
    const analysis: MarketIntelItem = {
      id: uid('ai'),
      symbol,
      classification: bull >= bear && bull >= side ? 'ALCISTA' : bear >= side ? 'BAJISTA' : 'LATERAL',
      prob_bullish: bull,
      prob_bearish: bear,
      prob_sideways: side,
      timeframe,
      indicators: {
        precioActual: lp,
        rsi14: 56.4,
        ema9: Number((lp * 0.998).toFixed(2)),
        ema21: Number((lp * 0.995).toFixed(2)),
      },
      news: [
        { title: 'Flujo cuantitativo en tiempo real (Binance)', source: 'Pukun Intel', note: 'Sin eventos extremos detectados.' },
      ],
      reasoning: `Análisis cuantitativo en ${timeframe} sobre ${symbol} ($${lp}): el precio se mantiene sobre medias rápidas con volumen balanceado y sesgo probabilístico favorable.`,
      risks: 'Volatilidad intradía y posibles barridos de liquidez cerca de soportes psicológicos. Usa siempre Stop Loss.',
      alternatives: 'Escenario alterno de consolidación lateral si el volumen disminuye durante la próxima sesión.',
      provider: 'Pukun Quant AI Engine',
      created_at: Date.now(),
    };
    state.analyses.unshift(analysis);
    saveState(state);
    return { analysis } as unknown as T;
  }

  // 9. Tokens & Token Factory
  if (pathname === '/api/tokens' && method === 'GET') {
    return { tokens: state.tokens } as unknown as T;
  }
  if (pathname === '/api/tokens/create' && method === 'POST') {
    const sym = String(body.symbol || 'PKN').toUpperCase();
    const pair = `${sym}/USDT`;
    const price = Number(body.initialPrice || body.initial_price_usdt || 0.25);
    const totalSupply = Number(body.totalSupply || 10000000);
    const contractAddress = `0xPukun${Math.random().toString(16).slice(2, 18).toUpperCase()}`;
    const tok: CustomToken = {
      id: uid('tok'),
      name: String(body.name || 'Custom Token'),
      symbol: sym,
      logo_color: String(body.logoColor || '#06b6d4'),
      description: String(body.description || 'Token desplegado en Pukun Token Factory.'),
      blockchain: String(body.blockchain || body.network || 'Ethereum'),
      standard: String(body.standard || 'ERC-20'),
      total_supply: totalSupply,
      initial_supply: Number(body.initialSupply || totalSupply),
      max_supply: Number(body.maxSupply || totalSupply),
      decimals: Number(body.decimals || 18),
      is_variable: 0,
      mintable: body.mintable ? 1 : 0,
      burnable: body.burnable ? 1 : 0,
      pausable: body.pausable ? 1 : 0,
      tokenomics: Array.isArray(body.tokenomics) ? body.tokenomics : [{ label: 'Comunidad', pct: 100, vesting: 'N/A' }],
      utilities: body.utilities || { staking: true },
      contract_address: contractAddress,
      audit_status: 'VERIFIED',
      deploy_stage: 'LISTED',
      listed_on_exchange: body.listOnExchange === false ? 0 : 1,
      launchpad_status: String(body.launchpadStatus || 'ACTIVE'),
      initial_price_usdt: price,
      movement_profile: (body.movementProfile || body.movement_profile || 'NORMAL') as TokenMovementProfile,
      movement_schedules: Array.isArray(body.movementSchedules || body.movement_schedules)
        ? (body.movementSchedules || body.movement_schedules)
        : [],
      created_at: Date.now(),
    };
    state.tokens.unshift(tok);
    if (!state.markets.some((m) => m.symbol === pair)) {
      state.markets.push({
        symbol: pair,
        base: sym,
        quote: 'USDT',
        base_price: price,
        last_price: price,
        high_24h: price * 1.08,
        low_24h: price * 0.94,
        change_24h: 4.2,
        volume_24h: 250000,
        spread_bps: 8,
        maker_fee_bps: Math.round((state.fees.spotMakerPct || 0.08) * 100),
        taker_fee_bps: Math.round((state.fees.spotTakerPct || 0.1) * 100),
        min_qty: 1,
        price_precision: 4,
        qty_precision: 2,
        spot_enabled: 1,
        futures_enabled: 1,
        max_leverage: 25,
        funding_rate: 0.0001,
        open_interest: 45000,
        is_custom_token: 1,
        liquidity_usdt: 150000,
        price_source: `CUSTOM_${tok.movement_profile || 'NORMAL'}`,
        active: tok.listed_on_exchange,
      });
    }
    saveState(state);
    return { symbol: pair, contractAddress, token: tok } as unknown as T;
  }
  const tokMatch = pathname.match(/^\/api\/tokens\/([^/]+)$/);
  if (tokMatch) {
    const id = tokMatch[1];
    if (method === 'DELETE') {
      state.tokens = state.tokens.filter((t) => t.id !== id);
    } else {
      const t = state.tokens.find((x) => x.id === id);
      if (t) Object.assign(t, body);
    }
    saveState(state);
    return { ok: true } as unknown as T;
  }

  // 10. Community, Referrals, Competitions & Notifications
  if (pathname === '/api/community/messages' && method === 'GET') {
    const room = params.get('room') || 'general';
    return { messages: state.messages.filter((m) => m.room === room) } as unknown as T;
  }
  if (pathname === '/api/community/messages' && method === 'POST') {
    const msg: ChatMessage = {
      id: uid('msg'),
      room: String(body.room || 'general'),
      user_id: 'me',
      author_name: String(body.userName || 'Trader Pukun'),
      author_role: 'USER',
      content: String(body.content || ''),
      attachment_json: '{}',
      pinned: 0,
      reported: 0,
      created_at: Date.now(),
    };
    state.messages.push(msg);
    saveState(state);
    return { message: msg } as unknown as T;
  }
  if (pathname.startsWith('/api/community/messages/')) {
    return { ok: true } as unknown as T;
  }
  if (pathname === '/api/referrals' && method === 'GET') {
    return {
      referralCode: 'PUKUN-40USDT',
      bonusPerReferralUsdt: 40,
      totalInvited: 0,
      totalEarnedUsdt: 0,
      referrals: [],
    } as unknown as T;
  }
  if (pathname === '/api/competitions' && method === 'GET') {
    return {
      competitions: [
        {
          id: 'comp_1',
          name: 'Copa Tiwanaku DEMO 2026',
          prizePool: '5.000 USDT',
          status: 'ACTIVE',
        },
      ],
      leaderboard: [
        { rank: 1, name: 'AndeanWhale', roiPct: 48.2, volumeUsdt: 142500 },
        { rank: 2, name: 'SatoshiLPZ', roiPct: 34.7, volumeUsdt: 98400 },
        { rank: 3, name: 'PukunMaster', roiPct: 27.1, volumeUsdt: 76200 },
      ],
    } as unknown as T;
  }
  if (pathname === '/api/notifications' && method === 'GET') {
    return { notifications: state.notifications } as unknown as T;
  }
  if (pathname === '/api/notifications/read-all' && method === 'POST') {
    state.notifications.forEach((n) => (n.read = 1));
    saveState(state);
    return { ok: true } as unknown as T;
  }

  // 11. Profile & Security & Superadmin fallbacks
  if (pathname === '/api/auth/me' && method === 'GET') {
    return { sessions: [], activity: [] } as unknown as T;
  }
  if (pathname === '/api/auth/2fa/setup' && method === 'POST') {
    return { secret: 'PUKUN2FASECRET2026', currentCode: '482910' } as unknown as T;
  }
  if (pathname.startsWith('/api/auth/')) {
    return { ok: true, message: 'Actualizado correctamente.' } as unknown as T;
  }
  if (pathname === '/api/superadmin/overview' && method === 'GET') {
    return {
      stats: {
        totalUsers: 1,
        totalOrders: state.orders.length,
        openFutures: state.positions.filter((p) => p.status === 'OPEN').length,
        activeBots: state.bots.filter((b) => b.status === 'ACTIVE').length,
        totalVolume24h: state.markets.reduce((acc, m) => acc + (m.volume_24h || 0), 0),
      },
      users: [
        {
          id: 'usr_superadmin',
          email: 'horaciowalterortiz@gmail.com',
          full_name: 'Horacio Walter Ortiz',
          role: 'SUPERADMIN',
          experience_level: 'PRO',
          kyc_status: 'VERIFIED',
          two_factor_enabled: 1,
          status: 'ACTIVE',
        },
      ],
      transactions: state.transactions.map((t) => ({ ...t, user_id: 'usr_superadmin' })),
      markets: state.markets,
      providers: [
        {
          id: 'prov_gemini',
          name: 'Google Gemini',
          provider_type: 'GEMINI',
          model: 'gemini-2.5-flash',
          priority: 1,
          enabled: 1,
          status: 'ACTIVE',
          max_rpm: 60,
        },
      ],
      reportedMsgs: [],
      configs: {
        branding: state.config.branding,
        demo_settings: state.config.demo_settings,
        quick_trading: state.config.quickTrading,
        referral_settings: state.referralSettings,
        enabled_modules: state.config.enabled_modules || {},
        fees: state.fees,
        promo_banners: state.promoBanners,
        future_events: state.futureEvents,
        missions: state.missions,
      },
      auditLogs: [],
    } as unknown as T;
  }
  const cfgMatch = pathname.match(/^\/api\/superadmin\/config\/([^/]+)$/);
  if (cfgMatch && (method === 'PATCH' || method === 'POST')) {
    const key = decodeURIComponent(cfgMatch[1]);
    const val = body.value !== undefined ? body.value : body;
    if (key === 'fees') {
      state.fees = { ...state.fees, ...val };
    } else if (key === 'promo_banners') {
      state.promoBanners = Array.isArray(val) ? val : state.promoBanners;
    } else if (key === 'future_events') {
      state.futureEvents = Array.isArray(val) ? val : state.futureEvents;
    } else if (key === 'missions') {
      state.missions = Array.isArray(val) ? val : state.missions;
    } else if (key === 'referral_settings') {
      state.referralSettings = { ...state.referralSettings, ...val };
    } else if (key === 'quick_trading') {
      state.config.quickTrading = val;
    } else {
      state.config[key] = val;
    }
    saveState(state);
    return { ok: true } as unknown as T;
  }
  if (pathname === '/api/superadmin/quick-trades' && method === 'GET') {
    await settleExpiredQuickTrades(state);
    const allQt = state.quickTrades;
    const summarize = (list: QuickTradeItem[]) => {
      const wins = list.filter((x) => x.status === 'WON').length;
      const losses = list.filter((x) => x.status === 'LOST').length;
      const settled = wins + losses;
      return {
        total: list.length,
        active: list.filter((x) => x.status === 'ACTIVE').length,
        wins,
        losses,
        draws: list.filter((x) => x.status === 'DRAW').length,
        cancelled: list.filter((x) => x.status === 'CANCELLED').length,
        winRatePct: settled > 0 ? Number(((wins / settled) * 100).toFixed(1)) : 0,
        totalVolume: Number(list.reduce((a, b) => a + b.amount, 0).toFixed(2)),
        traderNetPnl: Number(list.reduce((a, b) => a + b.profit, 0).toFixed(2)),
      };
    };
    return {
      trades: envParam ? allQt.filter((t) => t.env === envParam) : allQt,
      stats: {
        global: summarize(allQt),
        demo: summarize(allQt.filter((t) => t.env === 'DEMO')),
        real: summarize(allQt.filter((t) => t.env === 'REAL')),
      },
      auditLogs: [],
    } as unknown as T;
  }
  if (pathname.startsWith('/api/superadmin/')) {
    return { ok: true } as unknown as T;
  }

  return { ok: true } as unknown as T;
}
