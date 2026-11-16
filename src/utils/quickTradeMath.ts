export interface QuickTradeThermalColors {
  highProfit: string;
  lowProfit: string;
  neutral: string;
  moderateLoss: string;
  highLoss: string;
  pending: string;
  aiAccent: string;
}

export interface QuickTradeConfig {
  enabled: boolean;
  demoOnly: boolean;
  payoutPct: number;
  minAmount: number;
  maxAmount: number;
  durations: number[];
  animationsEnabled: boolean;
  priceProvider: 'AUTO' | 'BINANCE_PUBLIC' | 'SIMULATED_FEED';
  assetPayouts: Record<string, number>;
  durationPayouts: Record<string, number>;
  thermalColors: QuickTradeThermalColors;
}

export const DEFAULT_THERMAL_COLORS: QuickTradeThermalColors = {
  highProfit: '#10B981',
  lowProfit: '#6EE7B7',
  neutral: '#EAB308',
  moderateLoss: '#F97316',
  highLoss: '#EF4444',
  pending: '#3B82F6',
  aiAccent: '#8B5CF6',
};

export const DEFAULT_QUICK_TRADE_CONFIG: QuickTradeConfig = {
  enabled: true,
  demoOnly: true,
  payoutPct: 85,
  minAmount: 5,
  maxAmount: 2500,
  durations: [15, 30, 60, 180, 300],
  animationsEnabled: true,
  priceProvider: 'AUTO',
  assetPayouts: {},
  durationPayouts: {},
  thermalColors: { ...DEFAULT_THERMAL_COLORS },
};

export function mergeQuickTradeConfig(raw?: Partial<QuickTradeConfig> | null): QuickTradeConfig {
  const src = raw || {};
  return {
    enabled: src.enabled ?? DEFAULT_QUICK_TRADE_CONFIG.enabled,
    demoOnly: src.demoOnly ?? DEFAULT_QUICK_TRADE_CONFIG.demoOnly,
    payoutPct: Number.isFinite(Number(src.payoutPct)) ? Number(src.payoutPct) : DEFAULT_QUICK_TRADE_CONFIG.payoutPct,
    minAmount: Number.isFinite(Number(src.minAmount)) ? Number(src.minAmount) : DEFAULT_QUICK_TRADE_CONFIG.minAmount,
    maxAmount: Number.isFinite(Number(src.maxAmount)) ? Number(src.maxAmount) : DEFAULT_QUICK_TRADE_CONFIG.maxAmount,
    durations:
      Array.isArray(src.durations) && src.durations.length > 0
        ? src.durations.map((d) => Number(d)).filter((d) => Number.isFinite(d) && d > 0)
        : [...DEFAULT_QUICK_TRADE_CONFIG.durations],
    animationsEnabled: src.animationsEnabled ?? DEFAULT_QUICK_TRADE_CONFIG.animationsEnabled,
    priceProvider:
      src.priceProvider === 'BINANCE_PUBLIC' || src.priceProvider === 'SIMULATED_FEED'
        ? src.priceProvider
        : 'AUTO',
    assetPayouts: src.assetPayouts && typeof src.assetPayouts === 'object' ? { ...src.assetPayouts } : {},
    durationPayouts: src.durationPayouts && typeof src.durationPayouts === 'object' ? { ...src.durationPayouts } : {},
    thermalColors: {
      ...DEFAULT_THERMAL_COLORS,
      ...(src.thermalColors && typeof src.thermalColors === 'object' ? src.thermalColors : {}),
    },
  };
}

export function resolveQuickTradePayout(cfg: QuickTradeConfig, symbol: string, durationSec: number): number {
  const base = Number(cfg.payoutPct) || 85;
  const assetSpecific = cfg.assetPayouts?.[symbol];
  const durationSpecific = cfg.durationPayouts?.[String(durationSec)];

  let resolved = base;
  if (Number.isFinite(Number(assetSpecific)) && Number(assetSpecific) > 0) {
    resolved = Number(assetSpecific);
  }
  if (Number.isFinite(Number(durationSpecific)) && Number(durationSpecific) > 0) {
    if (Number.isFinite(Number(assetSpecific)) && Number(assetSpecific) > 0) {
      resolved = Number(assetSpecific) + (Number(durationSpecific) - base);
    } else {
      resolved = Number(durationSpecific);
    }
  }
  return Math.min(98, Math.max(50, Number(resolved.toFixed(2))));
}

export type ThermalZone =
  | 'HIGH_PROFIT'
  | 'LOW_PROFIT'
  | 'NEUTRAL'
  | 'MODERATE_LOSS'
  | 'HIGH_LOSS'
  | 'PENDING';

export type LiveTradeStatusLabel = 'EN GANANCIA' | 'EN PÉRDIDA' | 'NEUTRAL' | 'FINALIZANDO';

export interface QuickTradeLiveMetrics {
  priceDiff: number;
  signedPricePct: number;
  signedBps: number;
  potentialProfit: number;
  projectedSettlementPnl: number;
  dynamicPnl: number;
  dynamicReturnPct: number;
  thermalZone: ThermalZone;
  thermalColor: string;
  thermalScore: number; // 0..100 for bar indicator
  statusLabel: LiveTradeStatusLabel;
  isWinningAtCurrentPrice: boolean;
  isDrawAtCurrentPrice: boolean;
}

export function computeQuickTradeLiveMetrics(params: {
  direction: 'UP' | 'DOWN';
  amount: number;
  entryPrice: number;
  currentPrice: number;
  payoutPct: number;
  createdAt: number;
  expiresAt: number;
  nowMs: number;
  thermalColors?: QuickTradeThermalColors;
}): QuickTradeLiveMetrics {
  const {
    direction,
    amount,
    entryPrice,
    currentPrice,
    payoutPct,
    createdAt,
    expiresAt,
    nowMs,
    thermalColors = DEFAULT_THERMAL_COLORS,
  } = params;

  const safeEntry = entryPrice > 0 ? entryPrice : 1;
  const safeCurrent = currentPrice > 0 ? currentPrice : safeEntry;
  const priceDiff = safeCurrent - safeEntry;
  const directionalDiff = direction === 'UP' ? priceDiff : -priceDiff;
  const signedPricePct = (directionalDiff / safeEntry) * 100;
  const signedBps = signedPricePct * 100;

  const potentialProfit = Number(((amount * payoutPct) / 100).toFixed(2));
  const isDrawAtCurrentPrice = Math.abs(priceDiff) <= safeEntry * 1e-8;
  const isWinningAtCurrentPrice = !isDrawAtCurrentPrice && directionalDiff > 0;

  const totalDurationMs = Math.max(1000, expiresAt - createdAt);
  const elapsedRatio = Math.min(1, Math.max(0, (nowMs - createdAt) / totalDurationMs));
  // As expiration nears, sensitivity tightens smoothly around the entry strike
  const sensitivityBps = 18 * (1 - 0.65 * elapsedRatio);
  const edgeIntensity = Math.tanh(signedBps / Math.max(2, sensitivityBps)); // (-1, +1)

  const dynamicPnl = isDrawAtCurrentPrice
    ? 0
    : edgeIntensity >= 0
    ? Number((potentialProfit * edgeIntensity).toFixed(2))
    : Number((amount * edgeIntensity).toFixed(2));
  const projectedSettlementPnl = dynamicPnl;
  const dynamicReturnPct = amount > 0 ? Number(((dynamicPnl / amount) * 100).toFixed(2)) : 0;

  let thermalZone: ThermalZone = 'NEUTRAL';
  let thermalColor = thermalColors.neutral;

  if (nowMs - createdAt < 400 && isDrawAtCurrentPrice) {
    thermalZone = 'PENDING';
    thermalColor = thermalColors.pending;
  } else if (dynamicReturnPct >= payoutPct * 0.42) {
    thermalZone = 'HIGH_PROFIT';
    thermalColor = thermalColors.highProfit;
  } else if (dynamicReturnPct > 1.2) {
    thermalZone = 'LOW_PROFIT';
    thermalColor = thermalColors.lowProfit;
  } else if (dynamicReturnPct >= -1.2) {
    thermalZone = 'NEUTRAL';
    thermalColor = thermalColors.neutral;
  } else if (dynamicReturnPct > -42) {
    thermalZone = 'MODERATE_LOSS';
    thermalColor = thermalColors.moderateLoss;
  } else {
    thermalZone = 'HIGH_LOSS';
    thermalColor = thermalColors.highLoss;
  }

  const thermalScore = Math.min(100, Math.max(0, 50 + edgeIntensity * 50));

  let statusLabel: LiveTradeStatusLabel = 'NEUTRAL';
  if (expiresAt - nowMs <= 2000) {
    statusLabel = 'FINALIZANDO';
  } else if (Math.abs(dynamicPnl) < 0.05) {
    statusLabel = 'NEUTRAL';
  } else if (dynamicPnl > 0) {
    statusLabel = 'EN GANANCIA';
  } else {
    statusLabel = 'EN PÉRDIDA';
  }

  return {
    priceDiff,
    signedPricePct,
    signedBps,
    potentialProfit,
    projectedSettlementPnl,
    dynamicPnl,
    dynamicReturnPct,
    thermalZone,
    thermalColor,
    thermalScore,
    statusLabel,
    isWinningAtCurrentPrice,
    isDrawAtCurrentPrice,
  };
}

export interface QuickTradeSettlementResult {
  status: 'WON' | 'LOST' | 'DRAW';
  profit: number;
  returnAmount: number;
  returnPct: number;
}

export function computeQuickTradeSettlement(params: {
  direction: 'UP' | 'DOWN';
  amount: number;
  entryPrice: number;
  closePrice: number;
  payoutPct: number;
  createdAt: number;
  expiresAt: number;
  settledAt?: number;
}): QuickTradeSettlementResult {
  const {
    direction,
    amount,
    entryPrice,
    closePrice,
    payoutPct,
    createdAt,
    expiresAt,
    settledAt = expiresAt,
  } = params;

  const evalTime = Math.max(expiresAt, settledAt);
  const metrics = computeQuickTradeLiveMetrics({
    direction,
    amount,
    entryPrice,
    currentPrice: closePrice,
    payoutPct,
    createdAt,
    expiresAt,
    nowMs: evalTime,
  });

  const maxProfit = Number(((amount * payoutPct) / 100).toFixed(2));
  const clamped = Math.max(-amount, Math.min(maxProfit, metrics.dynamicPnl));
  const profit = metrics.isDrawAtCurrentPrice || Math.abs(clamped) < 0.01 ? 0 : Number(clamped.toFixed(2));
  const status: 'WON' | 'LOST' | 'DRAW' = profit > 0 ? 'WON' : profit < 0 ? 'LOST' : 'DRAW';
  const returnAmount = Number(Math.max(0, amount + profit).toFixed(2));
  const returnPct = amount > 0 ? Number(((profit / amount) * 100).toFixed(2)) : 0;

  return {
    status,
    profit,
    returnAmount,
    returnPct,
  };
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}
