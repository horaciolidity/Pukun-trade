import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'exchange.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'USER',
      experience_level TEXT NOT NULL DEFAULT 'BEGINNER',
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT DEFAULT '',
      email_verified INTEGER NOT NULL DEFAULT 1,
      kyc_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      referral_code TEXT UNIQUE NOT NULL,
      referred_by TEXT DEFAULT '',
      favorites_json TEXT NOT NULL DEFAULT '["BTC/USDT","ETH/USDT","SOL/USDT"]',
      notifications_prefs_json TEXT NOT NULL DEFAULT '{"signals":true,"orders":true,"bots":true,"security":true,"community":true}',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device TEXT NOT NULL,
      ip TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '127.0.0.1',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      env TEXT NOT NULL CHECK(env IN ('DEMO','REAL')),
      asset TEXT NOT NULL,
      available REAL NOT NULL DEFAULT 0,
      locked REAL NOT NULL DEFAULT 0,
      addresses_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(user_id, env, asset),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      env TEXT NOT NULL CHECK(env IN ('DEMO','REAL')),
      type TEXT NOT NULL,
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      txid TEXT NOT NULL,
      address TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS withdrawal_whitelist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS markets (
      symbol TEXT PRIMARY KEY,
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      base_price REAL NOT NULL,
      last_price REAL NOT NULL,
      high_24h REAL NOT NULL,
      low_24h REAL NOT NULL,
      change_24h REAL NOT NULL DEFAULT 0,
      volume_24h REAL NOT NULL DEFAULT 0,
      spread_bps REAL NOT NULL DEFAULT 4,
      maker_fee_bps REAL NOT NULL DEFAULT 10,
      taker_fee_bps REAL NOT NULL DEFAULT 10,
      min_qty REAL NOT NULL DEFAULT 0.0001,
      price_precision INTEGER NOT NULL DEFAULT 2,
      qty_precision INTEGER NOT NULL DEFAULT 4,
      spot_enabled INTEGER NOT NULL DEFAULT 1,
      futures_enabled INTEGER NOT NULL DEFAULT 1,
      max_leverage INTEGER NOT NULL DEFAULT 125,
      funding_rate REAL NOT NULL DEFAULT 0.0001,
      open_interest REAL NOT NULL DEFAULT 0,
      is_custom_token INTEGER NOT NULL DEFAULT 0,
      liquidity_usdt REAL NOT NULL DEFAULT 25000000,
      price_source TEXT NOT NULL DEFAULT 'SIMULATED_FEED',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      env TEXT NOT NULL CHECK(env IN ('DEMO','REAL')),
      market_symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
      type TEXT NOT NULL,
      price REAL NOT NULL,
      stop_price REAL DEFAULT 0,
      limit_price REAL DEFAULT 0,
      qty REAL NOT NULL,
      filled_qty REAL NOT NULL DEFAULT 0,
      fee REAL NOT NULL DEFAULT 0,
      fee_asset TEXT NOT NULL DEFAULT 'USDT',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS futures_positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      env TEXT NOT NULL CHECK(env IN ('DEMO','REAL')),
      market_symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
      margin_mode TEXT NOT NULL CHECK(margin_mode IN ('CROSS','ISOLATED')),
      leverage INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      qty REAL NOT NULL,
      margin REAL NOT NULL,
      liq_price REAL NOT NULL,
      stop_loss REAL DEFAULT 0,
      take_profit REAL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      funding_paid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      closed_at INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quick_trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      env TEXT NOT NULL CHECK(env IN ('DEMO','REAL')),
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('UP','DOWN')),
      amount REAL NOT NULL,
      duration_sec INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      close_price REAL DEFAULT 0,
      payout_pct REAL NOT NULL DEFAULT 85,
      status TEXT NOT NULL,
      profit REAL NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      closed_at INTEGER DEFAULT 0,
      return_pct REAL DEFAULT 0,
      max_positive_pnl REAL DEFAULT 0,
      max_negative_pnl REAL DEFAULT 0,
      effective_duration_sec INTEGER DEFAULT 0,
      price_source TEXT DEFAULT 'SIMULATED_FEED',
      cancel_reason TEXT DEFAULT '',
      pnl_history_json TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      env TEXT NOT NULL CHECK(env IN ('DEMO','REAL')),
      bot_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      strategy_summary TEXT NOT NULL,
      symbol TEXT NOT NULL,
      allocated_usdt REAL NOT NULL DEFAULT 500,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'STOPPED',
      config_json TEXT NOT NULL DEFAULT '{}',
      trades_count INTEGER NOT NULL DEFAULT 0,
      wins_count INTEGER NOT NULL DEFAULT 0,
      pnl REAL NOT NULL DEFAULT 0,
      historical_backtest_pct REAL NOT NULL DEFAULT 0,
      is_template INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT')),
      category TEXT NOT NULL,
      current_price REAL NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      timeframe TEXT NOT NULL,
      indicators_json TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      generator_bot TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'OPEN',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_intel (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      classification TEXT NOT NULL,
      prob_bullish INTEGER NOT NULL,
      prob_bearish INTEGER NOT NULL,
      prob_sideways INTEGER NOT NULL,
      timeframe TEXT NOT NULL,
      indicators_json TEXT NOT NULL,
      news_json TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      risks TEXT NOT NULL,
      alternatives TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT UNIQUE NOT NULL,
      logo_color TEXT NOT NULL DEFAULT '#3B82F6',
      description TEXT NOT NULL,
      blockchain TEXT NOT NULL,
      standard TEXT NOT NULL,
      total_supply REAL NOT NULL,
      initial_supply REAL NOT NULL,
      max_supply REAL NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 18,
      is_variable INTEGER NOT NULL DEFAULT 0,
      mintable INTEGER NOT NULL DEFAULT 0,
      burnable INTEGER NOT NULL DEFAULT 1,
      pausable INTEGER NOT NULL DEFAULT 1,
      tokenomics_json TEXT NOT NULL,
      utilities_json TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      audit_status TEXT NOT NULL DEFAULT 'PASSED_SIMULATED',
      deploy_stage TEXT NOT NULL DEFAULT 'TESTNET_DEPLOYED',
      listed_on_exchange INTEGER NOT NULL DEFAULT 0,
      launchpad_status TEXT NOT NULL DEFAULT 'AVAILABLE',
      initial_price_usdt REAL NOT NULL DEFAULT 0.25,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      user_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachment_json TEXT DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      reported INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      referred_email TEXT NOT NULL,
      reward_usdt REAL NOT NULL DEFAULT 25,
      status TEXT NOT NULL DEFAULT 'ELIGIBLE',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      period TEXT NOT NULL,
      virtual_capital REAL NOT NULL DEFAULT 10000,
      prize_pool_desc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      start_date INTEGER NOT NULL,
      end_date INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      model TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'CONFIGURED',
      max_rpm INTEGER NOT NULL DEFAULT 30
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Idempotent migration for existing quick_trades tables
  const qtCols = (db.prepare(`PRAGMA table_info(quick_trades)`).all() as Array<{ name: string }>).map((c) => c.name);
  const qtMigrations: Array<[string, string]> = [
    ['closed_at', 'INTEGER DEFAULT 0'],
    ['return_pct', 'REAL DEFAULT 0'],
    ['max_positive_pnl', 'REAL DEFAULT 0'],
    ['max_negative_pnl', 'REAL DEFAULT 0'],
    ['effective_duration_sec', 'INTEGER DEFAULT 0'],
    ['price_source', "TEXT DEFAULT 'SIMULATED_FEED'"],
    ['cancel_reason', "TEXT DEFAULT ''"],
    ['pnl_history_json', "TEXT DEFAULT '[]'"],
  ];
  for (const [col, def] of qtMigrations) {
    if (!qtCols.includes(col)) {
      db.exec(`ALTER TABLE quick_trades ADD COLUMN ${col} ${def}`);
    }
  }

  seedInitialData();
}

export function ensureUserDemoWallets(userId: string) {
  const cfgRow = db.prepare(`SELECT value_json FROM system_config WHERE key = 'demo_settings'`).get() as { value_json: string } | undefined;
  const demoCfg = cfgRow ? JSON.parse(cfgRow.value_json) : { initialCapital: 10000 };
  const initialUsdt = Number(demoCfg.initialCapital || 10000);

  const assets = ['USDT', 'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE'];
  const insertWallet = db.prepare(`
    INSERT OR IGNORE INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);

  for (const env of ['DEMO', 'REAL'] as const) {
    for (const asset of assets) {
      const avail = env === 'DEMO' && asset === 'USDT' ? initialUsdt : 0;
      const addresses = generateDeterministicAddresses(userId, asset, env);
      insertWallet.run(
        `${userId}_${env}_${asset}`,
        userId,
        env,
        asset,
        avail,
        JSON.stringify(addresses)
      );
    }
  }
}

export function generateDeterministicAddresses(userId: string, asset: string, env: string) {
  const hash = (net: string) =>
    crypto.createHash('sha256').update(`${userId}:${env}:${asset}:${net}`).digest('hex');

  return {
    Bitcoin: env === 'DEMO' ? `tb1q${hash('btc').slice(0, 34)}` : `bc1q${hash('btc').slice(0, 34)}`,
    Ethereum: `0x${hash('eth').slice(0, 40)}`,
    'BNB Smart Chain': `0x${hash('bsc').slice(0, 40)}`,
    Polygon: `0x${hash('matic').slice(0, 40)}`,
    Arbitrum: `0x${hash('arb').slice(0, 40)}`,
    Optimism: `0x${hash('op').slice(0, 40)}`,
    Base: `0x${hash('base').slice(0, 40)}`,
    Tron: `T${hash('trx').slice(0, 33).toUpperCase()}`,
    Solana: `${hash('sol').slice(0, 44)}`,
  };
}

function seedInitialData() {
  const now = Date.now();

  // Seed System Config
  const configs: Record<string, unknown> = {
    branding: {
      name: 'CRYPTO AI EXCHANGE',
      defaultCurrency: 'USDT',
      defaultLanguage: 'es',
      announcement: 'Entorno DEMO activo con 10.000 USDT virtuales. Practica Spot, Futuros hasta 125x, Quick Trading y Bots IA sin riesgo financiero real.',
    },
    demo_settings: {
      initialCapital: 10000,
      feeBps: 10,
      spreadBps: 4,
      slippageBps: 3,
      maxLeverage: 125,
      allowTopup: true,
    },
    quick_trading: {
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
      thermalColors: {
        highProfit: '#10B981',
        lowProfit: '#6EE7B7',
        neutral: '#EAB308',
        moderateLoss: '#F97316',
        highLoss: '#EF4444',
        pending: '#3B82F6',
        aiAccent: '#8B5CF6',
      },
    },
    referral_settings: {
      inviteRewardUsdt: 25,
      firstDepositBonusPct: 10,
      commissionPct: 15,
      maxMonthlyRewardsUsdt: 2500,
      antiFraudMinTrades: 3,
    },
    enabled_modules: {
      spot: true,
      futures: true,
      bots: true,
      signals: true,
      marketIntel: true,
      quickTrading: true,
      wallet: true,
      tokenFactory: true,
      launchpad: true,
      referrals: true,
      community: true,
      competitions: true,
      academy: true,
    },
  };

  const insertConfig = db.prepare(`INSERT OR IGNORE INTO system_config (key, value_json) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(configs)) {
    insertConfig.run(k, JSON.stringify(v));
  }

  // Seed AI Providers (multi-provider architecture)
  const existingProviders = (db.prepare(`SELECT COUNT(*) as cnt FROM ai_providers`).get() as { cnt: number }).cnt;
  if (existingProviders === 0) {
    const insertProvider = db.prepare(`
      INSERT INTO ai_providers (id, name, provider_type, model, priority, enabled, status, max_rpm)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertProvider.run('prov_gemini', 'Google Gemini', 'GEMINI', 'gemini-4-hydrogen', 1, 1, process.env.GEMINI_API_KEY ? 'ACTIVE' : 'ENV_KEY_REQUIRED', 60);
    insertProvider.run('prov_openai', 'OpenAI', 'OPENAI', 'gpt-4.1', 2, 0, 'STANDBY_CONFIGURE_ENV', 40);
    insertProvider.run('prov_deepseek', 'DeepSeek', 'DEEPSEEK', 'deepseek-reasoner', 3, 0, 'STANDBY_CONFIGURE_ENV', 40);
    insertProvider.run('prov_groq', 'Groq', 'GROQ', 'llama-3.3-70b-versatile', 4, 0, 'STANDBY_CONFIGURE_ENV', 100);
    insertProvider.run('prov_openrouter', 'OpenRouter', 'OPENROUTER', 'auto-router', 5, 0, 'STANDBY_CONFIGURE_ENV', 50);
    insertProvider.run('prov_cerebras', 'Cerebras', 'CEREBRAS', 'llama-3.3-70b', 6, 0, 'STANDBY_CONFIGURE_ENV', 60);
    insertProvider.run('prov_mistral', 'Mistral AI', 'MISTRAL', 'mistral-large-latest', 7, 0, 'STANDBY_CONFIGURE_ENV', 40);
    insertProvider.run('prov_qwen', 'Alibaba Qwen', 'QWEN', 'qwen-max', 8, 0, 'STANDBY_CONFIGURE_ENV', 40);
    insertProvider.run('prov_hf', 'Hugging Face', 'HUGGINGFACE', 'inference-endpoints', 9, 0, 'STANDBY_CONFIGURE_ENV', 30);
  }

  // Seed initial 7 Markets
  const initialMarkets = [
    { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', price: 91450.0, high: 92800, low: 89600, change: 2.18, vol: 1845200000, pp: 2, qp: 5, lev: 125 },
    { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', price: 3240.5, high: 3310, low: 3155, change: 1.84, vol: 912400000, pp: 2, qp: 4, lev: 100 },
    { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', price: 214.8, high: 221.4, low: 204.2, change: 4.35, vol: 540800000, pp: 2, qp: 3, lev: 75 },
    { symbol: 'XRP/USDT', base: 'XRP', quote: 'USDT', price: 1.124, high: 1.18, low: 1.06, change: 3.12, vol: 418900000, pp: 4, qp: 1, lev: 50 },
    { symbol: 'BNB/USDT', base: 'BNB', quote: 'USDT', price: 632.4, high: 645.0, low: 618.0, change: -0.64, vol: 289000000, pp: 2, qp: 3, lev: 75 },
    { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', price: 0.742, high: 0.775, low: 0.71, change: 2.91, vol: 175600000, pp: 4, qp: 1, lev: 50 },
    { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', price: 0.368, high: 0.389, low: 0.342, change: -1.45, vol: 365400000, pp: 4, qp: 0, lev: 50 },
  ];

  const insertMarket = db.prepare(`
    INSERT OR IGNORE INTO markets (
      symbol, base, quote, base_price, last_price, high_24h, low_24h, change_24h, volume_24h,
      spread_bps, maker_fee_bps, taker_fee_bps, min_qty, price_precision, qty_precision,
      spot_enabled, futures_enabled, max_leverage, funding_rate, open_interest, is_custom_token, liquidity_usdt, price_source, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 10, 10, 0.0001, ?, ?, 1, 1, ?, 0.0001, ?, 0, 28000000, 'SIMULATED_FEED', 1)
  `);

  for (const m of initialMarkets) {
    insertMarket.run(
      m.symbol, m.base, m.quote, m.price, m.price, m.high, m.low, m.change, m.vol,
      m.pp, m.qp, m.lev, Math.round(m.vol * 0.35)
    );
  }

  // Seed Demo Trader & Superadmin Users
  const traderId = 'usr_demo_trader';
  const adminId = 'usr_superadmin';
  const modId = 'usr_moderator';

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, password_hash, full_name, role, experience_level, two_factor_enabled,
      email_verified, kyc_status, referral_code, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 'ACTIVE', ?)
  `);

  insertUser.run(
    traderId,
    'trader@cryptoai.demo',
    bcrypt.hashSync('DemoTrader2026!', 10),
    'Alex Rivera',
    'USER',
    'INTERMEDIATE',
    'VERIFIED',
    'CRYPTOAI-ALEX',
    now - 86400000 * 7
  );

  insertUser.run(
    adminId,
    'superadmin@cryptoai.demo',
    bcrypt.hashSync('SuperAdmin2026!', 10),
    'Elena Vance (Superadmin)',
    'SUPERADMIN',
    'PRO',
    'VERIFIED',
    'CRYPTOAI-ROOT',
    now - 86400000 * 30
  );

  insertUser.run(
    modId,
    'mod@cryptoai.demo',
    bcrypt.hashSync('ModTeam2026!', 10),
    'Marco Solis',
    'MODERATOR',
    'PRO',
    'VERIFIED',
    'CRYPTOAI-MOD',
    now - 86400000 * 14
  );

  ensureUserDemoWallets(traderId);
  ensureUserDemoWallets(adminId);
  ensureUserDemoWallets(modId);

  // Seed Bot Templates (7 types)
  const existingBots = (db.prepare(`SELECT COUNT(*) as cnt FROM bots WHERE user_id = ?`).get(traderId) as { cnt: number }).cnt;
  if (existingBots === 0) {
    const botTemplates = [
      {
        id: 'bot_scalping_1',
        type: 'SCALPING',
        name: 'Pulse Scalper',
        desc: 'Ejecución de corto plazo basada en RSI(14), cruces EMA(9/21), MACD y picos de volumen intradía.',
        strat: 'RSI < 34 + cruce alcista EMA9/EMA21 con confirmación de volumen.',
        symbol: 'BTC/USDT',
        alloc: 1200,
        risk: 'MEDIO',
        cfg: { rsiPeriod: 14, rsiOversold: 34, rsiOverbought: 68, emaFast: 9, emaSlow: 21, stopLossPct: 0.8, takeProfitPct: 1.4 },
        backtest: 14.8,
        trades: 42,
        wins: 29,
        pnl: 164.2,
      },
      {
        id: 'bot_trend_1',
        type: 'TREND',
        name: 'Horizon Trend Follower',
        desc: 'Seguimiento de tendencia direccional con detección automática de soportes, resistencias y rupturas.',
        strat: 'Ruptura de resistencia con EMA21 > SMA50 y ATR trailing stop.',
        symbol: 'ETH/USDT',
        alloc: 1500,
        risk: 'MEDIO',
        cfg: { emaPeriod: 21, smaPeriod: 50, atrMultiplier: 2.0, stopLossPct: 1.8, takeProfitPct: 4.2 },
        backtest: 21.4,
        trades: 18,
        wins: 12,
        pnl: 218.5,
      },
      {
        id: 'bot_grid_1',
        type: 'GRID',
        name: 'Matrix Grid Range',
        desc: 'Compra escalonada en soportes y venta automática en resistencias dentro de un rango lateral configurable.',
        strat: '10 niveles equidistantes con toma de ganancias por rejilla de 0.75%.',
        symbol: 'SOL/USDT',
        alloc: 1000,
        risk: 'BAJO',
        cfg: { lowerPrice: 195, upperPrice: 235, grids: 10, stepPct: 0.75 },
        backtest: 11.2,
        trades: 64,
        wins: 51,
        pnl: 98.4,
      },
      {
        id: 'bot_dca_1',
        type: 'DCA',
        name: 'Accumulate DCA Pro',
        desc: 'Compras periódicas programadas para optimizar el precio promedio de entrada ante retrocesos.',
        strat: 'Compras fraccionadas cada intervalo con reducción de costo promedio en caídas >2%.',
        symbol: 'BTC/USDT',
        alloc: 800,
        risk: 'BAJO',
        cfg: { intervalMinutes: 60, orderSizeUsdt: 80, dipBoostPct: 2.0 },
        backtest: 9.6,
        trades: 10,
        wins: 8,
        pnl: 54.1,
      },
      {
        id: 'bot_arb_1',
        type: 'ARBITRAGE',
        name: 'CrossSpread Arbitrage',
        desc: 'Comparación de diferenciales de cotización entre libros de órdenes descontando comisiones maker/taker.',
        strat: 'Detección de spread neto > 0.22% tras comisiones estimadas.',
        symbol: 'XRP/USDT',
        alloc: 1000,
        risk: 'BAJO',
        cfg: { minNetSpreadPct: 0.22, maxSlippagePct: 0.08 },
        backtest: 6.4,
        trades: 27,
        wins: 24,
        pnl: 41.8,
      },
      {
        id: 'bot_aipred_1',
        type: 'AI_PREDICTIVE',
        name: 'Neural Predictive Engine',
        desc: 'Combina indicadores técnicos, volumen, sentimiento y modelos probabilísticos IA sin prometer retornos.',
        strat: 'Entrada únicamente cuando probabilidad direccional IA >= 62% con riesgo acotado.',
        symbol: 'SOL/USDT',
        alloc: 1500,
        risk: 'ALTO',
        cfg: { minConfidence: 62, maxDrawdownPct: 5, stopLossPct: 1.5, takeProfitPct: 3.1 },
        backtest: 24.1,
        trades: 23,
        wins: 16,
        pnl: 189.3,
      },
      {
        id: 'bot_fut_1',
        type: 'SMART_FUTURES',
        name: 'Apex Smart Futures',
        desc: 'Estrategias LONG/SHORT en perpetuos con gestión estricta de margen aislado, Stop Loss y Take Profit.',
        strat: 'LONG/SHORT con apalancamiento controlado 5x y SL automático al 1.2%.',
        symbol: 'ETH/USDT',
        alloc: 1000,
        risk: 'ALTO',
        cfg: { leverage: 5, marginMode: 'ISOLATED', stopLossPct: 1.2, takeProfitPct: 2.8 },
        backtest: 28.7,
        trades: 15,
        wins: 10,
        pnl: 142.0,
      },
    ];

    const insertBot = db.prepare(`
      INSERT INTO bots (
        id, user_id, env, bot_type, name, description, strategy_summary, symbol,
        allocated_usdt, risk_level, status, config_json, trades_count, wins_count, pnl,
        historical_backtest_pct, is_template, created_at
      ) VALUES (?, ?, 'DEMO', ?, ?, ?, ?, ?, ?, ?, 'PAUSED', ?, ?, ?, ?, ?, 1, ?)
    `);

    for (const b of botTemplates) {
      insertBot.run(
        b.id, traderId, b.type, b.name, b.desc, b.strat, b.symbol, b.alloc,
        b.risk, JSON.stringify(b.cfg), b.trades, b.wins, b.pnl, b.backtest, now - 3600000 * 12
      );
    }
  }

  // Seed initial Live Signals
  const existingSignals = (db.prepare(`SELECT COUNT(*) as cnt FROM signals`).get() as { cnt: number }).cnt;
  if (existingSignals === 0) {
    const insertSignal = db.prepare(`
      INSERT INTO signals (
        id, symbol, direction, category, current_price, entry_price, stop_loss, take_profit,
        timeframe, indicators_json, confidence, generator_bot, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertSignal.run('sig_1', 'BTC/USDT', 'LONG', 'BULLISH', 91450, 91300, 90150, 93800, '1H', JSON.stringify(['RSI 56.4', 'EMA9 > EMA21', 'MACD Alcista']), 78, 'Horizon Trend Follower', 'OPEN', now - 1800000);
    insertSignal.run('sig_2', 'SOL/USDT', 'LONG', 'OPPORTUNITY', 214.8, 213.5, 207.0, 228.5, '15M', JSON.stringify(['Volumen +38%', 'Ruptura Bollinger', 'RSI 61.2']), 82, 'Neural Predictive Engine', 'OPEN', now - 900000);
    insertSignal.run('sig_3', 'DOGE/USDT', 'SHORT', 'BEARISH', 0.368, 0.371, 0.384, 0.346, '1H', JSON.stringify(['Divergencia RSI', 'Rechazo EMA21']), 69, 'Pulse Scalper', 'OPEN', now - 2700000);
    insertSignal.run('sig_4', 'ETH/USDT', 'LONG', 'HIGH_VOLATILITY', 3240.5, 3230, 3165, 3360, '4H', JSON.stringify(['ATR Alto', 'Soporte 3155 confirmado']), 74, 'Apex Smart Futures', 'HIT_TP', now - 7200000);
  }

  // Seed initial Custom Token for Launchpad & Exchange Demo
  const existingTokens = (db.prepare(`SELECT COUNT(*) as cnt FROM custom_tokens`).get() as { cnt: number }).cnt;
  if (existingTokens === 0) {
    const tokenomics = [
      { label: 'Liquidez DEX/CEX', pct: 35, vesting: 'Bloqueo 24 meses' },
      { label: 'Comunidad y Staking', pct: 25, vesting: 'Liberación lineal 36 meses' },
      { label: 'Ecosistema & Bots IA', pct: 20, vesting: '6 meses cliff + 24 meses' },
      { label: 'Reserva del Proyecto', pct: 12, vesting: '12 meses cliff' },
      { label: 'Marketing y Alianzas', pct: 8, vesting: 'Desbloqueo trimestral' },
    ];
    const utilities = {
      trading: true,
      rewards: true,
      feeDiscounts: true,
      premiumAccess: true,
      loyalty: true,
      missions: true,
      staking: true,
      communityBenefits: true,
    };
    db.prepare(`
      INSERT INTO custom_tokens (
        id, name, symbol, logo_color, description, blockchain, standard,
        total_supply, initial_supply, max_supply, decimals, is_variable, mintable, burnable, pausable,
        tokenomics_json, utilities_json, contract_address, audit_status, deploy_stage,
        listed_on_exchange, launchpad_status, initial_price_usdt, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 18, 0, 0, 1, 1, ?, ?, ?, 'PASSED_SIMULATED', 'TESTNET_VERIFIED', 1, 'AVAILABLE', 1.45, ?, ?)
    `).run(
      'tok_caix',
      'CryptoAI Utility Token',
      'CAIX',
      '#3B82F6',
      'Token nativo de gobernanza, descuentos en comisiones y acceso a estrategias cuantitativas en CRYPTO AI EXCHANGE.',
      'Arbitrum',
      'ERC-20',
      100000000,
      25000000,
      100000000,
      JSON.stringify(tokenomics),
      JSON.stringify(utilities),
      '0x7a9C4eB289f114E5c8D290A3bF942a1E8100CA1X',
      adminId,
      now - 86400000 * 5
    );

    // List CAIX/USDT as custom market
    db.prepare(`
      INSERT OR IGNORE INTO markets (
        symbol, base, quote, base_price, last_price, high_24h, low_24h, change_24h, volume_24h,
        spread_bps, maker_fee_bps, taker_fee_bps, min_qty, price_precision, qty_precision,
        spot_enabled, futures_enabled, max_leverage, funding_rate, open_interest, is_custom_token, liquidity_usdt, price_source, active
      ) VALUES ('CAIX/USDT', 'CAIX', 'USDT', 1.45, 1.45, 1.52, 1.38, 3.85, 4250000, 8, 5, 8, 1, 4, 2, 1, 0, 1, 0, 0, 1, 1850000, 'INTERNAL_AMM_DEMO', 1)
    `).run();

    // Add CAIX wallet for seeded users
    for (const uid of [traderId, adminId, modId]) {
      for (const env of ['DEMO', 'REAL'] as const) {
        db.prepare(`
          INSERT OR IGNORE INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
          VALUES (?, ?, ?, 'CAIX', ?, 0, ?)
        `).run(`${uid}_${env}_CAIX`, uid, env, env === 'DEMO' ? 250 : 0, JSON.stringify(generateDeterministicAddresses(uid, 'CAIX', env)));
      }
    }
  }

  // Seed Community Chat Messages
  const existingMsgs = (db.prepare(`SELECT COUNT(*) as cnt FROM chat_messages`).get() as { cnt: number }).cnt;
  if (existingMsgs === 0) {
    const insertMsg = db.prepare(`
      INSERT INTO chat_messages (id, room, user_id, author_name, author_role, content, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMsg.run('msg_1', 'general', adminId, 'Elena Vance (Superadmin)', 'SUPERADMIN', 'Bienvenidos a la comunidad oficial de CRYPTO AI EXCHANGE. Recuerden verificar siempre si operan en DEMO o REAL antes de confirmar órdenes.', 1, now - 7200000);
    insertMsg.run('msg_2', 'bitcoin', traderId, 'Alex Rivera', 'USER', 'BTC consolidando arriba de 91k con volumen saludable en gráfico de 1H. Vigilando resistencia en 92.8k.', 0, now - 1800000);
    insertMsg.run('msg_3', 'bots', modId, 'Marco Solis', 'MODERATOR', 'Consejo de moderación: prueben el Matrix Grid Range en SOL/USDT en modo DEMO durante 24h antes de ajustar niveles.', 1, now - 3600000);
    insertMsg.run('msg_4', 'signals', adminId, 'Sistema Señales IA', 'SUPERADMIN', 'Todas las señales publicadas muestran datos técnicos verificables y deben gestionarse con Stop Loss obligatorio.', 1, now - 5400000);
  }

  // Seed Competitions
  const existingComp = (db.prepare(`SELECT COUNT(*) as cnt FROM competitions`).get() as { cnt: number }).cnt;
  if (existingComp === 0) {
    db.prepare(`
      INSERT INTO competitions (id, title, description, period, virtual_capital, prize_pool_desc, status, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(
      'comp_weekly_1',
      'Torneo Semanal DEMO — Estrategias Spot & Futuros',
      'Compite con 10.000 USDT virtuales idénticos. Clasificación calculada por ROI neto (%) verificable sin riesgo real.',
      'SEMANAL',
      10000,
      'Insignia Oro + 500 CAIX Virtuales de Torneo',
      now - 86400000 * 2,
      now + 86400000 * 5
    );
    db.prepare(`
      INSERT INTO competitions (id, title, description, period, virtual_capital, prize_pool_desc, status, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(
      'comp_bots_1',
      'Desafío Mensual de Bots Algorítmicos',
      'Optimiza tus bots de Scalping, Grid o AI Predictive en DEMO y mide consistencia vs drawdown.',
      'MENSUAL',
      10000,
      'Insignia Cuantitativa + Acceso Anticipado Launchpad',
      now - 86400000 * 6,
      now + 86400000 * 24
    );
  }
}
