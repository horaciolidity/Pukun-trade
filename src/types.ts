export type TradingEnv = 'DEMO' | 'REAL';
export type UserRole = 'USER' | 'MODERATOR' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';
export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'PRO';

export type NavSection =
  | 'dashboard'
  | 'markets'
  | 'spot'
  | 'futures'
  | 'quick-trade'
  | 'bots'
  | 'signals'
  | 'market-intel'
  | 'wallet'
  | 'token-factory'
  | 'launchpad'
  | 'referrals'
  | 'community'
  | 'competitions'
  | 'academy'
  | 'profile'
  | 'superadmin';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  role: UserRole;
  experience_level: ExperienceLevel;
  two_factor_enabled: number;
  email_verified: number;
  kyc_status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
  referral_code: string;
  favorites: string[];
  notificationPrefs: Record<string, boolean>;
  status: string;
  created_at: number;
}

export interface Market {
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

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

export interface OrderBook {
  symbol: string;
  lastPrice: number;
  spreadPct: number;
  bids: { price: number; qty: number; total: number }[];
  asks: { price: number; qty: number; total: number }[];
}

export interface WalletItem {
  asset: string;
  available: number;
  locked: number;
  usdPrice: number;
  usdValue: number;
  addresses: Record<string, string>;
}

export interface WalletTransaction {
  id: string;
  env: TradingEnv;
  type: string;
  asset: string;
  network: string;
  amount: number;
  fee: number;
  txid: string;
  address: string;
  status: string;
  created_at: number;
}

export interface SpotOrder {
  id: string;
  env: TradingEnv;
  market_symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  price: number;
  stop_price: number;
  qty: number;
  filled_qty: number;
  fee: number;
  fee_asset: string;
  status: string;
  created_at: number;
}

export interface FuturesPosition {
  id: string;
  env: TradingEnv;
  market_symbol: string;
  side: 'LONG' | 'SHORT';
  margin_mode: 'CROSS' | 'ISOLATED';
  leverage: number;
  entry_price: number;
  qty: number;
  margin: number;
  liq_price: number;
  stop_loss: number;
  take_profit: number;
  realized_pnl: number;
  funding_paid: number;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  created_at: number;
  closed_at: number;
}

export interface QuickTradePnlPoint {
  t: number;
  p: number;
  pnl: number;
}

export interface QuickTradeItem {
  id: string;
  env: TradingEnv;
  symbol: string;
  direction: 'UP' | 'DOWN';
  amount: number;
  duration_sec: number;
  entry_price: number;
  close_price: number;
  payout_pct: number;
  status: 'ACTIVE' | 'WON' | 'LOST' | 'DRAW' | 'CANCELLED';
  profit: number;
  expires_at: number;
  created_at: number;
  closed_at?: number;
  return_pct?: number;
  max_positive_pnl?: number;
  max_negative_pnl?: number;
  effective_duration_sec?: number;
  price_source?: string;
  cancel_reason?: string;
  pnl_history_json?: string;
}

export interface TradingBot {
  id: string;
  env: TradingEnv;
  bot_type: string;
  name: string;
  description: string;
  strategy_summary: string;
  symbol: string;
  allocated_usdt: number;
  risk_level: string;
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED';
  config_json: string;
  trades_count: number;
  wins_count: number;
  pnl: number;
  historical_backtest_pct: number;
  is_template: number;
  created_at: number;
}

export interface LiveSignal {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  category: string;
  current_price: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  timeframe: string;
  indicators: string[];
  confidence: number;
  generator_bot: string;
  outcome: string;
  created_at: number;
}

export interface MarketIntelItem {
  id: string;
  symbol: string;
  classification: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
  prob_bullish: number;
  prob_bearish: number;
  prob_sideways: number;
  timeframe: string;
  indicators: Record<string, number | string>;
  news: Array<{ title: string; source: string; note: string }>;
  reasoning: string;
  risks: string;
  alternatives: string;
  provider: string;
  created_at: number;
}

export type TokenMovementProfile = 'STABLECOIN' | 'CALM' | 'NORMAL' | 'VOLATILE';
export type TokenTrendBias = 'NEUTRAL' | 'BULLISH' | 'BEARISH';

export interface TokenBehaviorSchedule {
  id: string;
  startTime: string;
  endTime: string;
  profile: TokenMovementProfile;
  bias: TokenTrendBias;
  label?: string;
}

export interface AdminPromoBanner {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  ctaText: string;
  targetTab: NavSection;
  imageUrl: string;
  active: boolean;
  createdAt: number;
}

export interface AdminFutureEvent {
  id: string;
  title: string;
  rewardUsdt: number;
  startDate: string;
  endDate: string;
  description: string;
  active: boolean;
}

export interface AdminPlatformFees {
  spotMakerPct: number;
  spotTakerPct: number;
  futuresFeePct: number;
  withdrawFeeUsdt: number;
  withdrawFeePct: number;
}

export type MissionPlatform = 'TELEGRAM' | 'YOUTUBE' | 'X' | 'INSTAGRAM' | 'TIKTOK' | 'REFERRAL' | 'CUSTOM';

export interface AdminMissionTask {
  id: string;
  platform: MissionPlatform;
  title: string;
  description: string;
  rewardUsdt: number;
  rewardAsset: string;
  actionUrl: string;
  requiresProof: boolean;
  bannerImageUrl?: string;
  ipfsCid?: string;
  active: boolean;
  createdAt: number;
}

export interface MissionClaim {
  id: string;
  missionId: string;
  proofUrl: string;
  status: 'COMPLETED' | 'PENDING_REVIEW';
  rewardUsdt: number;
  createdAt: number;
}

export interface CryptoNewsItem {
  id: string;
  title: string;
  body: string;
  url: string;
  imageUrl: string;
  source: string;
  categories: string;
  publishedOn: number;
}

export interface CustomToken {
  id: string;
  name: string;
  symbol: string;
  logo_color: string;
  description: string;
  blockchain: string;
  standard: string;
  total_supply: number;
  initial_supply: number;
  max_supply: number;
  decimals: number;
  is_variable: number;
  mintable: number;
  burnable: number;
  pausable: number;
  tokenomics: Array<{ label: string; pct: number; vesting: string }>;
  utilities: Record<string, boolean>;
  contract_address: string;
  audit_status: string;
  deploy_stage: string;
  listed_on_exchange: number;
  launchpad_status: string;
  initial_price_usdt: number;
  movement_profile?: TokenMovementProfile;
  movement_schedules?: TokenBehaviorSchedule[];
  created_at: number;
}

export interface ChatMessage {
  id: string;
  room: string;
  user_id: string;
  author_name: string;
  author_role: string;
  content: string;
  attachment_json: string;
  pinned: number;
  reported: number;
  created_at: number;
}

export interface AppNotification {
  id: string;
  category: string;
  title: string;
  message: string;
  read: number;
  created_at: number;
}
