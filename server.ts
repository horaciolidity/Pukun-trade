import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase, ensureUserDemoWallets, generateDeterministicAddresses } from './server/db.ts';
import {
  AuthRequest,
  requireAuth,
  requireMinRole,
  signAuthToken,
  verifyAuthToken,
  logActivity,
  logAudit,
  createNotification,
  generateTwoFactorCode,
  verifyTwoFactorCode,
  UserRole,
} from './server/auth.ts';
import {
  startMarketEngine,
  setBroadcastHandler,
  getCandles,
  computeTechnicalIndicators,
  buildOrderBook,
  MarketRow,
  settleExpiredQuickTradesNow,
} from './server/marketEngine.ts';
import { analyzeMarketWithAI, generateTechnicalSignal } from './server/aiService.ts';
import {
  mergeQuickTradeConfig,
  resolveQuickTradePayout,
  QuickTradeConfig,
} from './src/utils/quickTradeMath.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '2mb' }));

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxReqs = 120, windowMs = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path.split('/').slice(0, 3).join('/')}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count++;
    if (bucket.count > maxReqs) {
      res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos segundos e intenta de nuevo.' });
      return;
    }
    next();
  };
}

app.use('/api', rateLimit(240, 60000));

function getConfig<T>(key: string, fallback: T): T {
  const row = db.prepare(`SELECT value_json FROM system_config WHERE key = ?`).get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

// ==========================================
// PUBLIC / BOOTSTRAP CONFIG
// ==========================================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: Date.now() });
});

app.get('/api/bootstrap', (_req, res) => {
  const branding = getConfig('branding', { name: 'CRYPTO AI EXCHANGE' });
  const modules = getConfig('enabled_modules', {});
  const demoSettings = getConfig('demo_settings', {});
  const quickTrading = mergeQuickTradeConfig(getConfig<Partial<QuickTradeConfig>>('quick_trading', {}));
  res.json({ branding, modules, demoSettings, quickTrading });
});

// ==========================================
// AUTH & USER SYSTEM
// ==========================================
app.post('/api/auth/register', rateLimit(20, 60000), (req, res) => {
  const { email, password, fullName, referralCode } = req.body as {
    email?: string;
    password?: string;
    fullName?: string;
    referralCode?: string;
  };

  if (!email || !password || !fullName) {
    res.status(400).json({ error: 'Correo, contraseña y nombre completo son obligatorios.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'Este correo ya está registrado.' });
    return;
  }

  const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
  const myRefCode = `CAIX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();

  let referrerId = '';
  if (referralCode) {
    const refUser = db.prepare(`SELECT id FROM users WHERE referral_code = ?`).get(referralCode.trim().toUpperCase()) as
      | { id: string }
      | undefined;
    if (refUser) {
      referrerId = refUser.id;
    }
  }

  db.prepare(`
    INSERT INTO users (
      id, email, password_hash, full_name, role, experience_level, two_factor_enabled,
      email_verified, kyc_status, referral_code, referred_by, status, created_at
    ) VALUES (?, ?, ?, ?, 'USER', 'BEGINNER', 0, 1, 'UNVERIFIED', ?, ?, 'ACTIVE', ?)
  `).run(userId, normalizedEmail, hash, fullName.trim(), myRefCode, referrerId, now);

  ensureUserDemoWallets(userId);

  if (referrerId) {
    const refCfg = getConfig('referral_settings', { inviteRewardUsdt: 25 });
    db.prepare(`
      INSERT INTO referrals (id, referrer_id, referred_user_id, referred_email, reward_usdt, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING_ACTIVITY', ?)
    `).run(`ref_${crypto.randomUUID().slice(0, 10)}`, referrerId, userId, normalizedEmail, refCfg.inviteRewardUsdt, now);
  }

  const sessionId = `ses_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`INSERT INTO sessions (id, user_id, device, ip, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`).run(
    sessionId,
    userId,
    String(req.headers['user-agent'] || 'Web Browser').slice(0, 80),
    req.ip || '127.0.0.1',
    now
  );

  logActivity(userId, 'REGISTER', 'Cuenta creada e iniciada en modo DEMO con capital virtual', req.ip);
  createNotification(
    userId,
    'SECURITY',
    'Bienvenido a CRYPTO AI EXCHANGE',
    'Tu cuenta inició en MODO DEMO con capital virtual para practicar sin riesgo.'
  );

  const token = signAuthToken({
    id: userId,
    email: normalizedEmail,
    full_name: fullName.trim(),
    role: 'USER',
    status: 'ACTIVE',
    sessionId,
  });

  res.json({ token, user: getSafeUserProfile(userId) });
});

app.post('/api/auth/login', rateLimit(30, 60000), (req, res) => {
  const { email, password, twoFactorCode } = req.body as {
    email?: string;
    password?: string;
    twoFactorCode?: string;
  };
  if (!email || !password) {
    res.status(400).json({ error: 'Ingresa tu correo y contraseña.' });
    return;
  }

  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.trim().toLowerCase()) as
    | {
        id: string;
        email: string;
        password_hash: string;
        full_name: string;
        role: UserRole;
        status: string;
        two_factor_enabled: number;
        two_factor_secret: string;
      }
    | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Credenciales inválidas.' });
    return;
  }

  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: `Cuenta ${user.status.toLowerCase()}. Contacta a soporte.` });
    return;
  }

  if (user.two_factor_enabled === 1) {
    if (!twoFactorCode) {
      res.status(200).json({ requires2FA: true, tempHint: generateTwoFactorCode(user.two_factor_secret) });
      return;
    }
    if (!verifyTwoFactorCode(user.two_factor_secret, twoFactorCode)) {
      res.status(401).json({ error: 'Código 2FA inválido o expirado.' });
      return;
    }
  }

  const sessionId = `ses_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`INSERT INTO sessions (id, user_id, device, ip, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`).run(
    sessionId,
    user.id,
    String(req.headers['user-agent'] || 'Web Browser').slice(0, 80),
    req.ip || '127.0.0.1',
    Date.now()
  );

  logActivity(user.id, 'LOGIN', 'Inicio de sesión exitoso', req.ip);

  const token = signAuthToken({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    sessionId,
  });

  res.json({ token, user: getSafeUserProfile(user.id) });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
    return;
  }
  res.json({
    ok: true,
    message: 'Si el correo está registrado, se ha generado un enlace de recuperación de un solo uso (simulado en entorno DEMO).',
  });
});

function getSafeUserProfile(userId: string) {
  const row = db
    .prepare(
      `SELECT id, email, full_name, avatar_url, role, experience_level, two_factor_enabled,
              email_verified, kyc_status, referral_code, favorites_json, notifications_prefs_json, status, created_at
       FROM users WHERE id = ?`
    )
    .get(userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    favorites: JSON.parse(String(row.favorites_json || '[]')),
    notificationPrefs: JSON.parse(String(row.notifications_prefs_json || '{}')),
  };
}

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  const profile = getSafeUserProfile(req.user!.id);
  const sessions = db
    .prepare(`SELECT id, device, ip, active, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`)
    .all(req.user!.id);
  const activity = db
    .prepare(`SELECT id, action, details, ip, created_at FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
    .all(req.user!.id);
  res.json({ user: profile, sessions, activity, currentSessionId: req.user!.sessionId });
});

app.patch('/api/auth/profile', requireAuth, (req: AuthRequest, res) => {
  const { fullName, avatarUrl, experienceLevel, notificationPrefs } = req.body as {
    fullName?: string;
    avatarUrl?: string;
    experienceLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'PRO';
    notificationPrefs?: Record<string, boolean>;
  };

  if (fullName) {
    db.prepare(`UPDATE users SET full_name = ? WHERE id = ?`).run(fullName.trim(), req.user!.id);
  }
  if (avatarUrl !== undefined) {
    db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(avatarUrl.trim(), req.user!.id);
  }
  if (experienceLevel && ['BEGINNER', 'INTERMEDIATE', 'PRO'].includes(experienceLevel)) {
    db.prepare(`UPDATE users SET experience_level = ? WHERE id = ?`).run(experienceLevel, req.user!.id);
  }
  if (notificationPrefs) {
    db.prepare(`UPDATE users SET notifications_prefs_json = ? WHERE id = ?`).run(
      JSON.stringify(notificationPrefs),
      req.user!.id
    );
  }

  logActivity(req.user!.id, 'PROFILE_UPDATE', 'Actualización de perfil o nivel de experiencia');
  res.json({ user: getSafeUserProfile(req.user!.id) });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'Contraseña actual y nueva (mínimo 8 caracteres) requeridas.' });
    return;
  }
  const user = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user!.id) as { password_hash: string };
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
    return;
  }
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(newPassword, 10), req.user!.id);
  logActivity(req.user!.id, 'PASSWORD_CHANGE', 'Contraseña actualizada');
  createNotification(req.user!.id, 'SECURITY', 'Contraseña actualizada', 'Tu contraseña ha sido cambiada correctamente.');
  res.json({ ok: true });
});

app.post('/api/auth/2fa/setup', requireAuth, (req: AuthRequest, res) => {
  const secret = crypto.randomBytes(16).toString('hex').toUpperCase();
  db.prepare(`UPDATE users SET two_factor_secret = ? WHERE id = ?`).run(secret, req.user!.id);
  const currentCode = generateTwoFactorCode(secret);
  res.json({ secret, currentCode });
});

app.post('/api/auth/2fa/toggle', requireAuth, (req: AuthRequest, res) => {
  const { enabled, code } = req.body as { enabled?: boolean; code?: string };
  const user = db.prepare(`SELECT two_factor_secret FROM users WHERE id = ?`).get(req.user!.id) as {
    two_factor_secret: string;
  };
  if (enabled) {
    if (!user.two_factor_secret || !code || !verifyTwoFactorCode(user.two_factor_secret, code)) {
      res.status(400).json({ error: 'Código 2FA inválido para activar la verificación.' });
      return;
    }
    db.prepare(`UPDATE users SET two_factor_enabled = 1 WHERE id = ?`).run(req.user!.id);
    logActivity(req.user!.id, '2FA_ENABLED', 'Autenticación de dos factores activada');
  } else {
    db.prepare(`UPDATE users SET two_factor_enabled = 0 WHERE id = ?`).run(req.user!.id);
    logActivity(req.user!.id, '2FA_DISABLED', 'Autenticación de dos factores desactivada');
  }
  res.json({ user: getSafeUserProfile(req.user!.id) });
});

app.post('/api/auth/kyc', requireAuth, (req: AuthRequest, res) => {
  const { documentType, country } = req.body as { documentType?: string; country?: string };
  if (!documentType || !country) {
    res.status(400).json({ error: 'Tipo de documento y país requeridos.' });
    return;
  }
  db.prepare(`UPDATE users SET kyc_status = 'PENDING' WHERE id = ?`).run(req.user!.id);
  logActivity(req.user!.id, 'KYC_SUBMITTED', `Solicitud KYC (${documentType}, ${country})`);
  res.json({ user: getSafeUserProfile(req.user!.id) });
});

app.post('/api/auth/sessions/:sessionId/revoke', requireAuth, (req: AuthRequest, res) => {
  db.prepare(`UPDATE sessions SET active = 0 WHERE id = ? AND user_id = ?`).run(req.params.sessionId, req.user!.id);
  logActivity(req.user!.id, 'SESSION_REVOKED', `Sesión cerrada: ${req.params.sessionId}`);
  res.json({ ok: true });
});

// ==========================================
// MARKETS, CANDLES & ORDER BOOK
// ==========================================
app.get('/api/markets', (_req, res) => {
  const markets = db.prepare(`SELECT * FROM markets WHERE active = 1 ORDER BY is_custom_token ASC, volume_24h DESC`).all();
  res.json({ markets });
});

app.get('/api/markets/:base/:quote/chart', (req, res) => {
  const symbol = `${req.params.base.toUpperCase()}/${req.params.quote.toUpperCase()}`;
  const timeframe = String(req.query.tf || '1m');
  const market = db.prepare(`SELECT * FROM markets WHERE symbol = ?`).get(symbol) as MarketRow | undefined;
  if (!market) {
    res.status(404).json({ error: 'Mercado no encontrado' });
    return;
  }
  const candles = getCandles(symbol, timeframe);
  const indicators = computeTechnicalIndicators(symbol);
  const orderBook = buildOrderBook(symbol, market.last_price, market.spread_bps);
  res.json({ market, candles, indicators, orderBook });
});

app.post('/api/markets/favorite', requireAuth, (req: AuthRequest, res) => {
  const { symbol } = req.body as { symbol?: string };
  if (!symbol) {
    res.status(400).json({ error: 'Símbolo requerido' });
    return;
  }
  const user = db.prepare(`SELECT favorites_json FROM users WHERE id = ?`).get(req.user!.id) as { favorites_json: string };
  const favs: string[] = JSON.parse(user.favorites_json || '[]');
  const idx = favs.indexOf(symbol);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(symbol);
  db.prepare(`UPDATE users SET favorites_json = ? WHERE id = ?`).run(JSON.stringify(favs), req.user!.id);
  res.json({ favorites: favs });
});

// ==========================================
// WALLET & STRICT DEMO / REAL ISOLATION
// ==========================================
function parseEnv(raw: unknown): 'DEMO' | 'REAL' {
  return raw === 'REAL' ? 'REAL' : 'DEMO';
}

app.get('/api/wallet', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.query.env);
  ensureUserDemoWallets(req.user!.id);

  const wallets = db
    .prepare(`SELECT asset, available, locked, addresses_json FROM wallets WHERE user_id = ? AND env = ? ORDER BY CASE WHEN asset='USDT' THEN 0 ELSE 1 END, available DESC`)
    .all(req.user!.id, env) as Array<{ asset: string; available: number; locked: number; addresses_json: string }>;

  const markets = db.prepare(`SELECT symbol, base, last_price FROM markets WHERE active = 1`).all() as Array<{
    symbol: string;
    base: string;
    last_price: number;
  }>;
  const priceMap = new Map<string, number>([['USDT', 1], ['USDC', 1]]);
  for (const m of markets) priceMap.set(m.base, m.last_price);

  let totalUsdt = 0;
  let availableUsdt = 0;
  let lockedUsdt = 0;
  const enriched = wallets.map((w) => {
    const px = priceMap.get(w.asset) || 0;
    const availVal = w.available * px;
    const lockVal = w.locked * px;
    totalUsdt += availVal + lockVal;
    availableUsdt += availVal;
    lockedUsdt += lockVal;
    return {
      asset: w.asset,
      available: Number(w.available.toFixed(6)),
      locked: Number(w.locked.toFixed(6)),
      usdPrice: px,
      usdValue: Number((availVal + lockVal).toFixed(2)),
      addresses: JSON.parse(w.addresses_json || '{}'),
    };
  });

  const transactions = db
    .prepare(`SELECT * FROM wallet_transactions WHERE user_id = ? AND env = ? ORDER BY created_at DESC LIMIT 40`)
    .all(req.user!.id, env);

  const whitelist = db
    .prepare(`SELECT * FROM withdrawal_whitelist WHERE user_id = ? ORDER BY created_at DESC`)
    .all(req.user!.id);

  res.json({
    env,
    summary: {
      totalUsdt: Number(totalUsdt.toFixed(2)),
      availableUsdt: Number(availableUsdt.toFixed(2)),
      lockedUsdt: Number(lockedUsdt.toFixed(2)),
    },
    wallets: enriched,
    transactions,
    whitelist,
  });
});

app.post('/api/wallet/demo/reset', requireAuth, (req: AuthRequest, res) => {
  const demoCfg = getConfig('demo_settings', { initialCapital: 10000 });
  const initialUsdt = Number(demoCfg.initialCapital || 10000);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE user_id = ? AND env = 'DEMO' AND status = 'OPEN'`).run(req.user!.id);
    db.prepare(`UPDATE futures_positions SET status = 'CLOSED', closed_at = ? WHERE user_id = ? AND env = 'DEMO' AND status = 'OPEN'`).run(Date.now(), req.user!.id);
    db.prepare(`UPDATE quick_trades SET status = 'DRAW', profit = 0 WHERE user_id = ? AND env = 'DEMO' AND status = 'ACTIVE'`).run(req.user!.id);
    db.prepare(`UPDATE wallets SET available = 0, locked = 0 WHERE user_id = ? AND env = 'DEMO'`).run(req.user!.id);
    db.prepare(`UPDATE wallets SET available = ?, locked = 0 WHERE user_id = ? AND env = 'DEMO' AND asset = 'USDT'`).run(
      initialUsdt,
      req.user!.id
    );
    db.prepare(`
      INSERT INTO wallet_transactions (id, user_id, env, type, asset, network, amount, fee, txid, address, status, created_at)
      VALUES (?, ?, 'DEMO', 'DEMO_RESET', 'USDT', 'Virtual Ledger', ?, 0, ?, 'DEMO_FAUCET', 'CONFIRMED', ?)
    `).run(`wtx_${crypto.randomUUID().slice(0, 10)}`, req.user!.id, initialUsdt, `DEMO-RST-${Date.now()}`, Date.now());
  });
  tx();

  logActivity(req.user!.id, 'DEMO_RESET', `Cuenta DEMO restablecida a ${initialUsdt} USDT virtuales`);
  res.json({ ok: true, initialUsdt });
});

app.post('/api/wallet/demo/topup', requireAuth, (req: AuthRequest, res) => {
  const demoCfg = getConfig('demo_settings', { allowTopup: true });
  if (!demoCfg.allowTopup) {
    res.status(403).json({ error: 'Las recargas DEMO están deshabilitadas por el Superadmin.' });
    return;
  }
  const amount = Math.min(25000, Math.max(100, Number(req.body.amount || 2500)));
  db.prepare(`UPDATE wallets SET available = available + ? WHERE user_id = ? AND env = 'DEMO' AND asset = 'USDT'`).run(
    amount,
    req.user!.id
  );
  db.prepare(`
    INSERT INTO wallet_transactions (id, user_id, env, type, asset, network, amount, fee, txid, address, status, created_at)
    VALUES (?, ?, 'DEMO', 'DEMO_TOPUP', 'USDT', 'Virtual Ledger', ?, 0, ?, 'DEMO_FAUCET', 'CONFIRMED', ?)
  `).run(`wtx_${crypto.randomUUID().slice(0, 10)}`, req.user!.id, amount, `DEMO-TOP-${Date.now()}`, Date.now());

  res.json({ ok: true, amount });
});

app.post('/api/wallet/deposit', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.body.env);
  const { asset, network, amount, txid } = req.body as {
    asset?: string;
    network?: string;
    amount?: number;
    txid?: string;
  };

  if (!asset || !network || !amount || amount <= 0) {
    res.status(400).json({ error: 'Activo, red y monto positivo requeridos.' });
    return;
  }

  if (env === 'REAL') {
    if (!txid || txid.trim().length < 16) {
      res.status(400).json({ error: 'En modo REAL debes proporcionar un TXID hash válido de blockchain para conciliación automática.' });
      return;
    }
    const duplicate = db.prepare(`SELECT id FROM wallet_transactions WHERE txid = ?`).get(txid.trim());
    if (duplicate) {
      res.status(409).json({ error: 'Este TXID ya fue registrado anteriormente.' });
      return;
    }
    // REAL deposits require blockchain confirmation / pending reconciliation — never blindly auto-credited
    db.prepare(`
      INSERT INTO wallet_transactions (id, user_id, env, type, asset, network, amount, fee, txid, address, status, created_at)
      VALUES (?, ?, 'REAL', 'DEPOSIT', ?, ?, ?, 0, ?, 'ONCHAIN_PENDING_CONFIRMATION', 'PENDING', ?)
    `).run(`wtx_${crypto.randomUUID().slice(0, 10)}`, req.user!.id, asset.toUpperCase(), network, amount, txid.trim(), Date.now());

    createNotification(req.user!.id, 'WALLET', 'Depósito REAL en verificación', `${amount} ${asset} en ${network} pendiente de confirmaciones on-chain.`);
    res.json({ ok: true, status: 'PENDING', message: 'Transacción registrada para verificación de confirmaciones en red.' });
    return;
  }

  // DEMO deposit simulation
  const cleanAsset = asset.toUpperCase();
  const addresses = generateDeterministicAddresses(req.user!.id, cleanAsset, 'DEMO') as Record<string, string>;
  const addr = addresses[network] || addresses.Ethereum;
  const demoTx = txid?.trim() || `0xDEMO${crypto.randomBytes(12).toString('hex')}`;

  db.prepare(`
    INSERT INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
    VALUES (?, ?, 'DEMO', ?, ?, 0, ?)
    ON CONFLICT(user_id, env, asset) DO UPDATE SET available = available + ?
  `).run(`${req.user!.id}_DEMO_${cleanAsset}`, req.user!.id, cleanAsset, amount, JSON.stringify(addresses), amount);

  db.prepare(`
    INSERT INTO wallet_transactions (id, user_id, env, type, asset, network, amount, fee, txid, address, status, created_at)
    VALUES (?, ?, 'DEMO', 'DEPOSIT', ?, ?, ?, 0, ?, ?, 'CONFIRMED', ?)
  `).run(`wtx_${crypto.randomUUID().slice(0, 10)}`, req.user!.id, cleanAsset, network, amount, demoTx, addr, Date.now());

  res.json({ ok: true, status: 'CONFIRMED', txid: demoTx });
});

app.post('/api/wallet/withdraw', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.body.env);
  if (env === 'DEMO') {
    res.status(403).json({ error: 'Los retiros están bloqueados en MODO DEMO. El saldo virtual no es retirable ni transferible a REAL.' });
    return;
  }

  const { asset, network, address, amount, twoFactorCode } = req.body as {
    asset?: string;
    network?: string;
    address?: string;
    amount?: number;
    twoFactorCode?: string;
  };

  if (!asset || !network || !address || !amount || amount <= 0) {
    res.status(400).json({ error: 'Completa activo, red, dirección de destino y monto válido.' });
    return;
  }

  const user = db.prepare(`SELECT two_factor_enabled, two_factor_secret, kyc_status FROM users WHERE id = ?`).get(req.user!.id) as {
    two_factor_enabled: number;
    two_factor_secret: string;
    kyc_status: string;
  };

  if (user.kyc_status !== 'VERIFIED') {
    res.status(403).json({ error: 'Debes completar la verificación KYC para solicitar retiros en modo REAL.' });
    return;
  }
  if (user.two_factor_enabled === 1 && !verifyTwoFactorCode(user.two_factor_secret, twoFactorCode || '')) {
    res.status(401).json({ error: 'Código 2FA requerido o incorrecto para autorizar retiro.' });
    return;
  }

  const cleanAsset = asset.toUpperCase();
  const wallet = db.prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = 'REAL' AND asset = ?`).get(req.user!.id, cleanAsset) as
    | { available: number }
    | undefined;

  if (!wallet || wallet.available < amount) {
    res.status(400).json({ error: 'Saldo REAL disponible insuficiente.' });
    return;
  }

  const fee = Number((amount * 0.002).toFixed(6));
  const isFlagged = amount >= 10000;
  const status = isFlagged ? 'FLAGGED' : 'PENDING';

  const tx = db.transaction(() => {
    db.prepare(`UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND env = 'REAL' AND asset = ?`).run(
      amount,
      amount,
      req.user!.id,
      cleanAsset
    );
    db.prepare(`
      INSERT INTO wallet_transactions (id, user_id, env, type, asset, network, amount, fee, txid, address, status, created_at)
      VALUES (?, ?, 'REAL', 'WITHDRAWAL', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`wtx_${crypto.randomUUID().slice(0, 10)}`, req.user!.id, cleanAsset, network, amount, fee, `PENDING_SIGN_${Date.now()}`, address.trim(), status, Date.now());
  });
  tx();

  createNotification(req.user!.id, 'WALLET', 'Solicitud de retiro registrada', `${amount} ${cleanAsset} hacia ${address.slice(0, 10)}... (${status})`);
  res.json({ ok: true, status });
});

app.post('/api/wallet/whitelist', requireAuth, (req: AuthRequest, res) => {
  const { asset, network, address, label } = req.body as { asset?: string; network?: string; address?: string; label?: string };
  if (!asset || !network || !address || !label) {
    res.status(400).json({ error: 'Todos los campos son requeridos para la lista blanca.' });
    return;
  }
  const id = `wl_${crypto.randomUUID().slice(0, 10)}`;
  db.prepare(`
    INSERT INTO withdrawal_whitelist (id, user_id, asset, network, address, label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.id, asset.toUpperCase(), network, address.trim(), label.trim(), Date.now());
  res.json({ ok: true, id });
});

// ==========================================
// SPOT EXCHANGE TERMINAL
// ==========================================
app.get('/api/spot/orders', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.query.env);
  const orders = db
    .prepare(`SELECT * FROM orders WHERE user_id = ? AND env = ? ORDER BY created_at DESC LIMIT 80`)
    .all(req.user!.id, env);
  res.json({ orders });
});

app.post('/api/spot/order', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.body.env);
  const { symbol, side, type, qty, price, stopPrice } = req.body as {
    symbol?: string;
    side?: 'BUY' | 'SELL';
    type?: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'OCO';
    qty?: number;
    price?: number;
    stopPrice?: number;
  };

  if (!symbol || !side || !type || !qty || qty <= 0) {
    res.status(400).json({ error: 'Parámetros de orden inválidos.' });
    return;
  }

  const market = db.prepare(`SELECT * FROM markets WHERE symbol = ? AND active = 1 AND spot_enabled = 1`).get(symbol) as MarketRow | undefined;
  if (!market) {
    res.status(404).json({ error: 'Mercado Spot no disponible.' });
    return;
  }

  if (qty < market.min_qty) {
    res.status(400).json({ error: `Cantidad mínima para ${symbol}: ${market.min_qty}` });
    return;
  }

  const [base, quote] = symbol.split('/');
  const demoCfg = getConfig('demo_settings', { feeBps: 10, slippageBps: 3, spreadBps: 4 });
  const slippageFactor = type === 'MARKET' ? (side === 'BUY' ? 1 + demoCfg.slippageBps / 10000 : 1 - demoCfg.slippageBps / 10000) : 1;
  const targetPrice = type === 'MARKET' ? Number((market.last_price * slippageFactor).toFixed(market.price_precision)) : Number(price || market.last_price);

  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    res.status(400).json({ error: 'Precio inválido.' });
    return;
  }

  const totalQuote = targetPrice * qty;
  const feeBps = type === 'MARKET' ? market.taker_fee_bps : market.maker_fee_bps;
  const fee = Number(((totalQuote * feeBps) / 10000).toFixed(4));
  const orderId = `ord_${crypto.randomUUID().slice(0, 12)}`;
  const now = Date.now();

  if (side === 'BUY') {
    const quoteWallet = db.prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = ? AND asset = ?`).get(req.user!.id, env, quote) as
      | { available: number }
      | undefined;
    const requiredQuote = type === 'MARKET' ? totalQuote + fee : totalQuote;
    if (!quoteWallet || quoteWallet.available < requiredQuote) {
      res.status(400).json({ error: `Saldo ${quote} insuficiente en ${env}. Requerido: ${requiredQuote.toFixed(2)} ${quote}` });
      return;
    }

    const tx = db.transaction(() => {
      if (type === 'MARKET') {
        db.prepare(`UPDATE wallets SET available = available - ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
          requiredQuote,
          req.user!.id,
          env,
          quote
        );
        db.prepare(`
          INSERT INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
          VALUES (?, ?, ?, ?, ?, 0, '{}')
          ON CONFLICT(user_id, env, asset) DO UPDATE SET available = available + ?
        `).run(`${req.user!.id}_${env}_${base}`, req.user!.id, env, base, qty, qty);

        db.prepare(`
          INSERT INTO orders (id, user_id, env, market_symbol, side, type, price, stop_price, qty, filled_qty, fee, fee_asset, status, created_at)
          VALUES (?, ?, ?, ?, 'BUY', ?, ?, ?, ?, ?, ?, ?, 'FILLED', ?)
        `).run(orderId, req.user!.id, env, symbol, type, targetPrice, stopPrice || 0, qty, qty, fee, quote, now);
      } else {
        db.prepare(`UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
          totalQuote,
          totalQuote,
          req.user!.id,
          env,
          quote
        );
        db.prepare(`
          INSERT INTO orders (id, user_id, env, market_symbol, side, type, price, stop_price, qty, filled_qty, fee, fee_asset, status, created_at)
          VALUES (?, ?, ?, ?, 'BUY', ?, ?, ?, ?, 0, ?, ?, 'OPEN', ?)
        `).run(orderId, req.user!.id, env, symbol, type, targetPrice, stopPrice || 0, qty, fee, quote, now);
      }
    });
    tx();
  } else {
    const baseWallet = db.prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = ? AND asset = ?`).get(req.user!.id, env, base) as
      | { available: number }
      | undefined;
    if (!baseWallet || baseWallet.available < qty) {
      res.status(400).json({ error: `Saldo ${base} insuficiente en ${env}.` });
      return;
    }

    const tx = db.transaction(() => {
      if (type === 'MARKET') {
        db.prepare(`UPDATE wallets SET available = available - ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
          qty,
          req.user!.id,
          env,
          base
        );
        const netQuote = Math.max(0, totalQuote - fee);
        db.prepare(`
          INSERT INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
          VALUES (?, ?, ?, ?, ?, 0, '{}')
          ON CONFLICT(user_id, env, asset) DO UPDATE SET available = available + ?
        `).run(`${req.user!.id}_${env}_${quote}`, req.user!.id, env, quote, netQuote, netQuote);

        db.prepare(`
          INSERT INTO orders (id, user_id, env, market_symbol, side, type, price, stop_price, qty, filled_qty, fee, fee_asset, status, created_at)
          VALUES (?, ?, ?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, 'FILLED', ?)
        `).run(orderId, req.user!.id, env, symbol, type, targetPrice, stopPrice || 0, qty, qty, fee, quote, now);
      } else {
        db.prepare(`UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
          qty,
          qty,
          req.user!.id,
          env,
          base
        );
        db.prepare(`
          INSERT INTO orders (id, user_id, env, market_symbol, side, type, price, stop_price, qty, filled_qty, fee, fee_asset, status, created_at)
          VALUES (?, ?, ?, ?, 'SELL', ?, ?, ?, ?, 0, ?, ?, 'OPEN', ?)
        `).run(orderId, req.user!.id, env, symbol, type, targetPrice, stopPrice || 0, qty, fee, quote, now);
      }
    });
    tx();
  }

  createNotification(
    req.user!.id,
    'ORDERS',
    `Orden Spot ${type === 'MARKET' ? 'ejecutada' : 'abierta'} (${env})`,
    `${side} ${qty} ${base} @ ${targetPrice} ${quote}`
  );
  res.json({ ok: true, orderId, executedPrice: targetPrice, fee });
});

app.delete('/api/spot/orders/:orderId', requireAuth, (req: AuthRequest, res) => {
  const ord = db.prepare(`SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'OPEN'`).get(req.params.orderId, req.user!.id) as
    | { id: string; env: string; market_symbol: string; side: string; price: number; qty: number }
    | undefined;
  if (!ord) {
    res.status(404).json({ error: 'Orden abierta no encontrada.' });
    return;
  }

  const [base, quote] = ord.market_symbol.split('/');
  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`).run(ord.id);
    if (ord.side === 'BUY') {
      const unlockAmt = ord.price * ord.qty;
      db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
        unlockAmt,
        unlockAmt,
        req.user!.id,
        ord.env,
        quote
      );
    } else {
      db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
        ord.qty,
        ord.qty,
        req.user!.id,
        ord.env,
        base
      );
    }
  });
  tx();

  res.json({ ok: true });
});

// ==========================================
// FUTURES & LEVERAGE UP TO 125X
// ==========================================
app.get('/api/futures/positions', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.query.env);
  const positions = db
    .prepare(`SELECT * FROM futures_positions WHERE user_id = ? AND env = ? ORDER BY created_at DESC LIMIT 60`)
    .all(req.user!.id, env);
  res.json({ positions });
});

app.post('/api/futures/open', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.body.env);
  const { symbol, side, marginMode, leverage, marginUsdt, stopLoss, takeProfit } = req.body as {
    symbol?: string;
    side?: 'LONG' | 'SHORT';
    marginMode?: 'CROSS' | 'ISOLATED';
    leverage?: number;
    marginUsdt?: number;
    stopLoss?: number;
    takeProfit?: number;
  };

  if (env === 'REAL') {
    res.status(403).json({
      error: 'El trading de Futuros con dinero REAL requiere habilitación regulatoria e infraestructura de custodia externa verificada. Opera en MODO DEMO.',
    });
    return;
  }

  if (!symbol || !side || !marginMode || !leverage || !marginUsdt || marginUsdt <= 0) {
    res.status(400).json({ error: 'Parámetros de futuros inválidos.' });
    return;
  }

  const market = db.prepare(`SELECT * FROM markets WHERE symbol = ? AND active = 1 AND futures_enabled = 1`).get(symbol) as MarketRow | undefined;
  if (!market) {
    res.status(404).json({ error: 'Par de futuros no habilitado.' });
    return;
  }

  if (leverage < 1 || leverage > market.max_leverage) {
    res.status(400).json({ error: `Apalancamiento permitido para ${symbol}: 1x hasta ${market.max_leverage}x.` });
    return;
  }

  const usdtWallet = db.prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = ? AND asset = 'USDT'`).get(req.user!.id, env) as
    | { available: number }
    | undefined;
  if (!usdtWallet || usdtWallet.available < marginUsdt) {
    res.status(400).json({ error: 'Margen disponible en USDT insuficiente.' });
    return;
  }

  const entryPrice = market.last_price;
  const notional = marginUsdt * leverage;
  const qty = Number((notional / entryPrice).toFixed(5));
  const openFee = Number((notional * 0.0005).toFixed(4));
  const maintMarginRatio = 0.005;

  const liqPrice =
    side === 'LONG'
      ? Number((entryPrice * (1 - 1 / leverage + maintMarginRatio)).toFixed(market.price_precision))
      : Number((entryPrice * (1 + 1 / leverage - maintMarginRatio)).toFixed(market.price_precision));

  const posId = `fut_${crypto.randomUUID().slice(0, 12)}`;
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND env = ? AND asset = 'USDT'`).run(
      marginUsdt + openFee,
      marginUsdt,
      req.user!.id,
      env
    );
    db.prepare(`
      INSERT INTO futures_positions (
        id, user_id, env, market_symbol, side, margin_mode, leverage, entry_price, qty, margin, liq_price,
        stop_loss, take_profit, realized_pnl, funding_paid, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'OPEN', ?)
    `).run(posId, req.user!.id, env, symbol, side, marginMode, leverage, entryPrice, qty, marginUsdt, liqPrice, stopLoss || 0, takeProfit || 0, openFee, now);
  });
  tx();

  createNotification(
    req.user!.id,
    'ORDERS',
    `Posición Futuros abierta (${env})`,
    `${symbol} ${side} ${leverage}x · Entrada: ${entryPrice} · Liq: ${liqPrice}`
  );
  res.json({ ok: true, id: posId, entryPrice, liqPrice, qty });
});

app.post('/api/futures/:positionId/close', requireAuth, (req: AuthRequest, res) => {
  const pos = db.prepare(`SELECT * FROM futures_positions WHERE id = ? AND user_id = ? AND status = 'OPEN'`).get(
    req.params.positionId,
    req.user!.id
  ) as
    | {
        id: string;
        env: string;
        market_symbol: string;
        side: 'LONG' | 'SHORT';
        entry_price: number;
        qty: number;
        margin: number;
      }
    | undefined;

  if (!pos) {
    res.status(404).json({ error: 'Posición abierta no encontrada.' });
    return;
  }

  const market = db.prepare(`SELECT last_price FROM markets WHERE symbol = ?`).get(pos.market_symbol) as { last_price: number };
  const closePrice = market.last_price;
  const pnl = Number(
    (pos.side === 'LONG' ? (closePrice - pos.entry_price) * pos.qty : (pos.entry_price - closePrice) * pos.qty).toFixed(2)
  );
  const returnUsdt = Math.max(0, pos.margin + pnl);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE futures_positions SET status = 'CLOSED', realized_pnl = ?, closed_at = ? WHERE id = ?`).run(
      pnl,
      Date.now(),
      pos.id
    );
    db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = 'USDT'`).run(
      pos.margin,
      returnUsdt,
      req.user!.id,
      pos.env
    );
  });
  tx();

  res.json({ ok: true, pnl, closePrice });
});

// ==========================================
// QUICK TRADING PRO (DEMO / CONFIGURABLE)
// ==========================================
function formatCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildQuickTradesCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [
    'ID',
    'Fecha',
    'Hora Apertura',
    'Hora Cierre',
    'Cuenta',
    'Usuario',
    'Criptomoneda',
    'Direccion',
    'Duracion (s)',
    'Tiempo Efectivo (s)',
    'Importe (USDT)',
    'Precio Entrada',
    'Precio Cierre',
    'Payout (%)',
    'PnL Final (USDT)',
    'Rendimiento (%)',
    'Resultado',
    'Max PnL Positivo',
    'Max PnL Negativo',
    'Fuente Cotizacion',
    'Motivo Cancelacion',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const createdAt = Number(r.created_at || 0);
    const closedAt = Number(r.closed_at || 0);
    const dOpen = new Date(createdAt);
    const dClose = closedAt > 0 ? new Date(closedAt) : null;
    const statusMap: Record<string, string> = {
      WON: 'WIN',
      LOST: 'LOSS',
      DRAW: 'DRAW',
      CANCELLED: 'CANCELADA',
      ACTIVE: 'EN CURSO',
    };
    const rowVals = [
      r.id,
      dOpen.toISOString().slice(0, 10),
      dOpen.toISOString().slice(11, 19),
      dClose ? dClose.toISOString().slice(11, 19) : '',
      r.env,
      r.user_email || r.user_id,
      r.symbol,
      r.direction,
      r.duration_sec,
      r.effective_duration_sec || r.duration_sec,
      r.amount,
      r.entry_price,
      r.close_price,
      r.payout_pct,
      r.profit,
      r.return_pct ?? 0,
      statusMap[String(r.status)] || r.status,
      r.max_positive_pnl ?? 0,
      r.max_negative_pnl ?? 0,
      r.price_source || 'SIMULATED_FEED',
      r.cancel_reason || '',
    ];
    lines.push(rowVals.map(formatCsvCell).join(','));
  }
  return lines.join('\n');
}

app.get('/api/quick-trade/config', requireAuth, (_req, res) => {
  const quickTrading = mergeQuickTradeConfig(getConfig<Partial<QuickTradeConfig>>('quick_trading', {}));
  res.json({ config: quickTrading, serverNow: Date.now() });
});

app.get('/api/quick-trade/history', requireAuth, (req: AuthRequest, res) => {
  settleExpiredQuickTradesNow();
  const rawEnv = String(req.query.env || 'DEMO').toUpperCase();
  const quickTrading = mergeQuickTradeConfig(getConfig<Partial<QuickTradeConfig>>('quick_trading', {}));
  const trades =
    rawEnv === 'ALL'
      ? db.prepare(`SELECT * FROM quick_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 300`).all(req.user!.id)
      : db
          .prepare(`SELECT * FROM quick_trades WHERE user_id = ? AND env = ? ORDER BY created_at DESC LIMIT 300`)
          .all(req.user!.id, rawEnv === 'REAL' ? 'REAL' : 'DEMO');
  res.json({ trades, config: quickTrading });
});

app.get('/api/quick-trade/export-csv', requireAuth, (req: AuthRequest, res) => {
  settleExpiredQuickTradesNow();
  const rawEnv = String(req.query.env || 'ALL').toUpperCase();
  const rows = (
    rawEnv === 'ALL'
      ? db.prepare(`SELECT * FROM quick_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000`).all(req.user!.id)
      : db
          .prepare(`SELECT * FROM quick_trades WHERE user_id = ? AND env = ? ORDER BY created_at DESC LIMIT 1000`)
          .all(req.user!.id, rawEnv === 'REAL' ? 'REAL' : 'DEMO')
  ) as Array<Record<string, unknown>>;

  const csv = buildQuickTradesCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quick-trading-${rawEnv.toLowerCase()}.csv"`);
  res.send(csv);
});

app.post('/api/quick-trade/open', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.body.env);
  const qtCfg = mergeQuickTradeConfig(getConfig<Partial<QuickTradeConfig>>('quick_trading', {}));

  if (!qtCfg.enabled) {
    res.status(403).json({ error: 'Quick Trading desactivado temporalmente por el Superadmin.' });
    return;
  }
  if (env === 'REAL' && qtCfg.demoOnly) {
    res.status(403).json({
      error: 'Quick Trading está restringido al MODO DEMO hasta completar revisión legal y autorizaciones aplicables.',
    });
    return;
  }

  const { symbol, direction, amount, durationSec } = req.body as {
    symbol?: string;
    direction?: 'UP' | 'DOWN';
    amount?: number;
    durationSec?: number;
  };

  if (!symbol || !direction || !amount || !durationSec) {
    res.status(400).json({ error: 'Parámetros de Quick Trading incompletos.' });
    return;
  }
  if (!['UP', 'DOWN'].includes(direction)) {
    res.status(400).json({ error: 'Dirección inválida. Usa UP o DOWN.' });
    return;
  }
  if (amount < qtCfg.minAmount || amount > qtCfg.maxAmount) {
    res.status(400).json({ error: `Importe permitido: entre ${qtCfg.minAmount} y ${qtCfg.maxAmount} USDT.` });
    return;
  }
  if (qtCfg.durations.length > 0 && !qtCfg.durations.includes(Number(durationSec))) {
    res.status(400).json({ error: `Duración no habilitada (${durationSec}s).` });
    return;
  }

  const market = db.prepare(`SELECT last_price, price_source FROM markets WHERE symbol = ? AND active = 1`).get(symbol) as
    | { last_price: number; price_source: string }
    | undefined;
  if (!market) {
    res.status(404).json({ error: 'Activo no disponible.' });
    return;
  }

  const wallet = db.prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = ? AND asset = 'USDT'`).get(req.user!.id, env) as
    | { available: number }
    | undefined;
  if (!wallet || wallet.available < amount) {
    res.status(400).json({ error: 'Saldo USDT disponible insuficiente.' });
    return;
  }

  const resolvedPayout = resolveQuickTradePayout(qtCfg, symbol, Number(durationSec));
  const now = Date.now();
  const expiresAt = now + Number(durationSec) * 1000;
  const id = `qt_${crypto.randomUUID().slice(0, 12)}`;
  const initialHistory = JSON.stringify([{ t: now, p: market.last_price, pnl: 0 }]);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE wallets SET available = available - ?, locked = locked + ? WHERE user_id = ? AND env = ? AND asset = 'USDT'`).run(
      amount,
      amount,
      req.user!.id,
      env
    );
    db.prepare(`
      INSERT INTO quick_trades (
        id, user_id, env, symbol, direction, amount, duration_sec, entry_price, payout_pct, status,
        expires_at, created_at, price_source, pnl_history_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `).run(
      id,
      req.user!.id,
      env,
      symbol,
      direction,
      amount,
      Number(durationSec),
      market.last_price,
      resolvedPayout,
      expiresAt,
      now,
      market.price_source || 'SIMULATED_FEED',
      initialHistory
    );
  });
  tx();

  res.json({
    ok: true,
    id,
    entryPrice: market.last_price,
    expiresAt,
    payoutPct: resolvedPayout,
    priceSource: market.price_source || 'SIMULATED_FEED',
  });
});

app.post('/api/quick-trade/:id/cancel', requireAuth, (req: AuthRequest, res) => {
  const trade = db.prepare(`SELECT * FROM quick_trades WHERE id = ?`).get(req.params.id) as
    | {
        id: string;
        user_id: string;
        env: 'DEMO' | 'REAL';
        amount: number;
        status: string;
        created_at: number;
      }
    | undefined;

  if (!trade) {
    res.status(404).json({ error: 'Operación no encontrada.' });
    return;
  }
  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.user!.role);
  if (trade.user_id !== req.user!.id && !isAdmin) {
    res.status(403).json({ error: 'No autorizado para cancelar esta operación.' });
    return;
  }
  if (trade.status !== 'ACTIVE') {
    res.status(400).json({ error: 'Solo se pueden cancelar operaciones activas.' });
    return;
  }

  const now = Date.now();
  // Users can cancel only within 3s grace window unless admin overrides
  if (!isAdmin && now - trade.created_at > 3500) {
    res.status(400).json({ error: 'Ventana de cancelación expirada (solo primeros 3 segundos).' });
    return;
  }

  const reason = String((req.body as { reason?: string })?.reason || (isAdmin ? 'Cancelada por administrador' : 'Cancelación manual en ventana de gracia')).slice(0, 140);
  const effectiveSec = Math.max(1, Math.round((now - trade.created_at) / 1000));

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE quick_trades
       SET status = 'CANCELLED', profit = 0, return_pct = 0, closed_at = ?, effective_duration_sec = ?, cancel_reason = ?
       WHERE id = ? AND status = 'ACTIVE'`
    ).run(now, effectiveSec, reason, trade.id);
    db.prepare(
      `UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = 'USDT'`
    ).run(trade.amount, trade.amount, trade.user_id, trade.env);
  });
  tx();

  if (isAdmin) {
    logAudit(req.user!.id, req.user!.email, 'QUICK_TRADE_CANCELLED', trade.id, reason);
  }
  res.json({ ok: true, status: 'CANCELLED', cancel_reason: reason });
});

// ==========================================
// AI TRADING BOTS
// ==========================================
app.get('/api/bots', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.query.env);
  const myBots = db.prepare(`SELECT * FROM bots WHERE user_id = ? AND env = ? ORDER BY created_at DESC`).all(req.user!.id, env);
  const templates = db.prepare(`SELECT * FROM bots WHERE is_template = 1 GROUP BY bot_type`).all();
  res.json({ bots: myBots, templates });
});

app.post('/api/bots/create', requireAuth, (req: AuthRequest, res) => {
  const env = parseEnv(req.body.env);
  const { botType, name, symbol, allocatedUsdt, riskLevel, config } = req.body as {
    botType?: string;
    name?: string;
    symbol?: string;
    allocatedUsdt?: number;
    riskLevel?: string;
    config?: Record<string, unknown>;
  };

  if (env === 'REAL') {
    res.status(403).json({
      error: 'La ejecución automatizada de bots en REAL requiere autorización independiente de riesgo. Prueba y valida en MODO DEMO.',
    });
    return;
  }

  if (!botType || !name || !symbol || !allocatedUsdt || allocatedUsdt < 50) {
    res.status(400).json({ error: 'Capital mínimo para bot: 50 USDT.' });
    return;
  }

  const wallet = db.prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = ? AND asset = 'USDT'`).get(req.user!.id, env) as
    | { available: number }
    | undefined;
  if (!wallet || wallet.available < allocatedUsdt) {
    res.status(400).json({ error: 'Saldo USDT disponible insuficiente para asignar al bot.' });
    return;
  }

  const template = db.prepare(`SELECT description, strategy_summary, historical_backtest_pct FROM bots WHERE bot_type = ? AND is_template = 1 LIMIT 1`).get(botType) as
    | { description: string; strategy_summary: string; historical_backtest_pct: number }
    | undefined;

  const id = `bot_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO bots (
      id, user_id, env, bot_type, name, description, strategy_summary, symbol,
      allocated_usdt, risk_level, status, config_json, historical_backtest_pct, is_template, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 0, ?)
  `).run(
    id,
    req.user!.id,
    env,
    botType,
    name.trim(),
    template?.description || 'Bot algorítmico configurable en modo DEMO.',
    template?.strategy_summary || 'Estrategia automatizada basada en reglas técnicas.',
    symbol,
    allocatedUsdt,
    riskLevel || 'MEDIO',
    JSON.stringify(config || {}),
    template?.historical_backtest_pct || 12.5,
    Date.now()
  );

  createNotification(req.user!.id, 'BOTS', `Bot activado (${env})`, `${name} en ${symbol} con ${allocatedUsdt} USDT asignados.`);
  res.json({ ok: true, id });
});

app.patch('/api/bots/:botId', requireAuth, (req: AuthRequest, res) => {
  const { status, allocatedUsdt, symbol, config } = req.body as {
    status?: 'ACTIVE' | 'PAUSED' | 'STOPPED';
    allocatedUsdt?: number;
    symbol?: string;
    config?: Record<string, unknown>;
  };

  const bot = db.prepare(`SELECT * FROM bots WHERE id = ? AND user_id = ?`).get(req.params.botId, req.user!.id);
  if (!bot) {
    res.status(404).json({ error: 'Bot no encontrado en tu cuenta.' });
    return;
  }

  if (status && ['ACTIVE', 'PAUSED', 'STOPPED'].includes(status)) {
    db.prepare(`UPDATE bots SET status = ? WHERE id = ?`).run(status, req.params.botId);
  }
  if (allocatedUsdt && allocatedUsdt >= 50) {
    db.prepare(`UPDATE bots SET allocated_usdt = ? WHERE id = ?`).run(allocatedUsdt, req.params.botId);
  }
  if (symbol) {
    db.prepare(`UPDATE bots SET symbol = ? WHERE id = ?`).run(symbol, req.params.botId);
  }
  if (config) {
    db.prepare(`UPDATE bots SET config_json = ? WHERE id = ?`).run(JSON.stringify(config), req.params.botId);
  }
  res.json({ ok: true });
});

// ==========================================
// LIVE SIGNALS & MARKET INTELLIGENCE AI
// ==========================================
app.get('/api/signals', (_req, res) => {
  const signals = db.prepare(`SELECT * FROM signals ORDER BY created_at DESC LIMIT 40`).all() as Array<
    Record<string, unknown> & { indicators_json: string; outcome: string }
  >;
  const parsed = signals.map((s) => ({ ...s, indicators: JSON.parse(s.indicators_json || '[]') }));
  const total = parsed.length;
  const hitTp = parsed.filter((s) => s.outcome === 'HIT_TP').length;
  const hitSl = parsed.filter((s) => s.outcome === 'HIT_SL').length;
  const closed = hitTp + hitSl;
  res.json({
    signals: parsed,
    stats: {
      total,
      open: total - closed,
      hitTp,
      hitSl,
      winRatePct: closed > 0 ? Math.round((hitTp / closed) * 100) : 74,
    },
  });
});

app.post('/api/signals/generate', requireAuth, (req: AuthRequest, res) => {
  const { symbol, timeframe } = req.body as { symbol?: string; timeframe?: string };
  const sig = generateTechnicalSignal(symbol || 'BTC/USDT', timeframe || '15M');
  broadcastWS('signal:new', sig);
  res.json({ signal: sig });
});

app.get('/api/ai/intel', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM market_intel ORDER BY created_at DESC LIMIT 20`).all() as Array<
    Record<string, unknown> & { indicators_json: string; news_json: string }
  >;
  const analyses = rows.map((r) => ({
    ...r,
    indicators: JSON.parse(r.indicators_json || '{}'),
    news: JSON.parse(r.news_json || '[]'),
  }));
  res.json({ analyses });
});

app.post('/api/ai/analyze', requireAuth, rateLimit(15, 60000), async (req: AuthRequest, res) => {
  try {
    const { symbol, timeframe } = req.body as { symbol?: string; timeframe?: string };
    const result = await analyzeMarketWithAI(symbol || 'BTC/USDT', timeframe || '1H');
    res.json({ analysis: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error generando análisis IA.' });
  }
});

// ==========================================
// TOKEN FACTORY, LAUNCHPAD & LIQUIDITY
// ==========================================
app.get('/api/tokens', (_req, res) => {
  const tokens = db.prepare(`SELECT * FROM custom_tokens ORDER BY created_at DESC`).all() as Array<
    Record<string, unknown> & { tokenomics_json: string; utilities_json: string }
  >;
  res.json({
    tokens: tokens.map((t) => ({
      ...t,
      tokenomics: JSON.parse(t.tokenomics_json || '[]'),
      utilities: JSON.parse(t.utilities_json || '{}'),
    })),
  });
});

app.post('/api/tokens/create', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const {
    name,
    symbol,
    logoColor,
    description,
    blockchain,
    standard,
    totalSupply,
    initialSupply,
    maxSupply,
    decimals,
    isVariable,
    mintable,
    burnable,
    pausable,
    tokenomics,
    utilities,
    initialPriceUsdt,
    listOnExchange,
    launchpadStatus,
  } = req.body;

  if (!name || !symbol || !blockchain || !totalSupply) {
    res.status(400).json({ error: 'Nombre, símbolo, blockchain y suministro total son obligatorios.' });
    return;
  }

  const cleanSym = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const existing = db.prepare(`SELECT id FROM custom_tokens WHERE symbol = ?`).get(cleanSym);
  if (existing) {
    res.status(409).json({ error: `Ya existe un token con símbolo ${cleanSym}.` });
    return;
  }

  const id = `tok_${crypto.randomUUID().slice(0, 10)}`;
  const contractAddress =
    blockchain === 'Solana'
      ? `SPL${crypto.randomBytes(18).toString('hex').slice(0, 36)}`
      : `0x${crypto.randomBytes(20).toString('hex')}`;
  const price = Math.max(0.001, Number(initialPriceUsdt || 0.25));
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO custom_tokens (
        id, name, symbol, logo_color, description, blockchain, standard,
        total_supply, initial_supply, max_supply, decimals, is_variable, mintable, burnable, pausable,
        tokenomics_json, utilities_json, contract_address, audit_status, deploy_stage,
        listed_on_exchange, launchpad_status, initial_price_usdt, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PASSED_SIMULATED', 'TESTNET_VERIFIED', ?, ?, ?, ?, ?)
    `).run(
      id,
      String(name).trim(),
      cleanSym,
      logoColor || '#3B82F6',
      String(description || '').trim(),
      blockchain,
      standard || (blockchain === 'Solana' ? 'SPL' : 'ERC-20'),
      Number(totalSupply),
      Number(initialSupply || totalSupply),
      Number(maxSupply || totalSupply),
      Number(decimals || 18),
      isVariable ? 1 : 0,
      mintable ? 1 : 0,
      burnable ? 1 : 0,
      pausable ? 1 : 0,
      JSON.stringify(tokenomics || []),
      JSON.stringify(utilities || {}),
      contractAddress,
      listOnExchange ? 1 : 0,
      launchpadStatus || 'AVAILABLE',
      price,
      req.user!.id,
      now
    );

    if (listOnExchange) {
      const marketSym = `${cleanSym}/USDT`;
      db.prepare(`
        INSERT OR IGNORE INTO markets (
          symbol, base, quote, base_price, last_price, high_24h, low_24h, change_24h, volume_24h,
          spread_bps, maker_fee_bps, taker_fee_bps, min_qty, price_precision, qty_precision,
          spot_enabled, futures_enabled, max_leverage, is_custom_token, liquidity_usdt, price_source, active
        ) VALUES (?, ?, 'USDT', ?, ?, ?, ?, 0, 250000, 10, 10, 10, 1, 4, 2, 1, 0, 1, 1, 500000, 'INTERNAL_AMM_DEMO', 1)
      `).run(marketSym, cleanSym, price, price, price * 1.04, price * 0.96);
    }

    // Grant creator initial demo supply allocation for testing
    db.prepare(`
      INSERT OR IGNORE INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
      VALUES (?, ?, 'DEMO', ?, ?, 0, ?)
    `).run(`${req.user!.id}_DEMO_${cleanSym}`, req.user!.id, cleanSym, Math.min(10000, Number(initialSupply || 1000)), JSON.stringify(generateDeterministicAddresses(req.user!.id, cleanSym, 'DEMO')));
  });
  tx();

  logAudit(req.user!.id, req.user!.email, 'TOKEN_CREATED', cleanSym, `Desplegado en testnet simulada (${blockchain}, contrato ${contractAddress})`);
  res.json({ ok: true, id, symbol: cleanSym, contractAddress });
});

app.patch('/api/tokens/:tokenId', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const { listedOnExchange, launchpadStatus, utilities } = req.body as {
    listedOnExchange?: boolean;
    launchpadStatus?: string;
    utilities?: Record<string, boolean>;
  };

  const token = db.prepare(`SELECT * FROM custom_tokens WHERE id = ?`).get(req.params.tokenId) as
    | { id: string; symbol: string; initial_price_usdt: number }
    | undefined;
  if (!token) {
    res.status(404).json({ error: 'Token no encontrado.' });
    return;
  }

  if (listedOnExchange !== undefined) {
    db.prepare(`UPDATE custom_tokens SET listed_on_exchange = ? WHERE id = ?`).run(listedOnExchange ? 1 : 0, token.id);
    if (listedOnExchange) {
      const mSym = `${token.symbol}/USDT`;
      db.prepare(`
        INSERT OR IGNORE INTO markets (
          symbol, base, quote, base_price, last_price, high_24h, low_24h, change_24h, volume_24h,
          spread_bps, maker_fee_bps, taker_fee_bps, min_qty, price_precision, qty_precision,
          spot_enabled, futures_enabled, max_leverage, is_custom_token, liquidity_usdt, price_source, active
        ) VALUES (?, ?, 'USDT', ?, ?, ?, ?, 0, 150000, 10, 10, 10, 1, 4, 2, 1, 0, 1, 1, 350000, 'INTERNAL_AMM_DEMO', 1)
      `).run(mSym, token.symbol, token.initial_price_usdt, token.initial_price_usdt, token.initial_price_usdt * 1.03, token.initial_price_usdt * 0.97);
    } else {
      db.prepare(`UPDATE markets SET active = 0 WHERE base = ? AND is_custom_token = 1`).run(token.symbol);
    }
  }
  if (launchpadStatus) {
    db.prepare(`UPDATE custom_tokens SET launchpad_status = ? WHERE id = ?`).run(launchpadStatus, token.id);
  }
  if (utilities) {
    db.prepare(`UPDATE custom_tokens SET utilities_json = ? WHERE id = ?`).run(JSON.stringify(utilities), token.id);
  }

  logAudit(req.user!.id, req.user!.email, 'TOKEN_UPDATED', token.symbol, JSON.stringify({ listedOnExchange, launchpadStatus }));
  res.json({ ok: true });
});

// ==========================================
// COMMUNITY CHAT, REFERRALS, COMPETITIONS & NOTIFICATIONS
// ==========================================
app.get('/api/community/messages', (req, res) => {
  const room = String(req.query.room || 'general');
  const messages = db
    .prepare(`SELECT * FROM chat_messages WHERE room = ? ORDER BY pinned DESC, created_at ASC LIMIT 80`)
    .all(room);
  res.json({ messages });
});

app.post('/api/community/messages', requireAuth, (req: AuthRequest, res) => {
  const { room, content, attachment } = req.body as { room?: string; content?: string; attachment?: unknown };
  if (!room || !content || !content.trim()) {
    res.status(400).json({ error: 'Mensaje vacío.' });
    return;
  }

  const msg = {
    id: `msg_${crypto.randomUUID().slice(0, 12)}`,
    room,
    user_id: req.user!.id,
    author_name: req.user!.full_name,
    author_role: req.user!.role,
    content: content.trim().slice(0, 800),
    attachment_json: attachment ? JSON.stringify(attachment) : '',
    pinned: 0,
    reported: 0,
    created_at: Date.now(),
  };

  db.prepare(`
    INSERT INTO chat_messages (id, room, user_id, author_name, author_role, content, attachment_json, pinned, reported, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(msg.id, msg.room, msg.user_id, msg.author_name, msg.author_role, msg.content, msg.attachment_json, msg.created_at);

  broadcastWS('chat:message', msg);
  res.json({ message: msg });
});

app.post('/api/community/messages/:id/report', requireAuth, (req: AuthRequest, res) => {
  db.prepare(`UPDATE chat_messages SET reported = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/community/messages/:id/pin', requireAuth, requireMinRole('MODERATOR'), (req: AuthRequest, res) => {
  const row = db.prepare(`SELECT pinned FROM chat_messages WHERE id = ?`).get(req.params.id) as { pinned: number } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Mensaje no encontrado' });
    return;
  }
  db.prepare(`UPDATE chat_messages SET pinned = ? WHERE id = ?`).run(row.pinned ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/community/messages/:id', requireAuth, requireMinRole('MODERATOR'), (req: AuthRequest, res) => {
  db.prepare(`DELETE FROM chat_messages WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/referrals', requireAuth, (req: AuthRequest, res) => {
  const user = db.prepare(`SELECT referral_code FROM users WHERE id = ?`).get(req.user!.id) as { referral_code: string };
  const referrals = db.prepare(`SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC`).all(req.user!.id);
  const settings = getConfig('referral_settings', {});
  res.json({ referralCode: user.referral_code, referrals, settings });
});

app.get('/api/competitions', (_req, res) => {
  const competitions = db.prepare(`SELECT * FROM competitions ORDER BY start_date DESC`).all();
  // Live DEMO leaderboard computed from real DEMO wallet equity vs initial 10,000 USDT
  const users = db.prepare(`SELECT id, full_name, role FROM users WHERE status = 'ACTIVE'`).all() as Array<{
    id: string;
    full_name: string;
    role: string;
  }>;
  const markets = db.prepare(`SELECT base, last_price FROM markets WHERE active = 1`).all() as Array<{
    base: string;
    last_price: number;
  }>;
  const pMap = new Map<string, number>([['USDT', 1]]);
  for (const m of markets) pMap.set(m.base, m.last_price);

  const leaderboard = users
    .map((u) => {
      const wallets = db.prepare(`SELECT asset, available, locked FROM wallets WHERE user_id = ? AND env = 'DEMO'`).all(u.id) as Array<{
        asset: string;
        available: number;
        locked: number;
      }>;
      const equity = wallets.reduce((acc, w) => acc + (w.available + w.locked) * (pMap.get(w.asset) || 0), 0);
      const roiPct = Number((((equity - 10000) / 10000) * 100).toFixed(2));
      const ordersCount = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE user_id = ? AND env = 'DEMO'`).get(u.id) as { c: number }).c;
      return { userId: u.id, name: u.full_name, equityUsdt: Number(equity.toFixed(2)), roiPct, ordersCount };
    })
    .sort((a, b) => b.roiPct - a.roiPct);

  res.json({ competitions, leaderboard });
});

app.get('/api/notifications', requireAuth, (req: AuthRequest, res) => {
  const notifications = db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`)
    .all(req.user!.id);
  res.json({ notifications });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthRequest, res) => {
  db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ?`).run(req.user!.id);
  res.json({ ok: true });
});

// ==========================================
// SUPERADMIN CONTROL PANEL
// ==========================================
app.get('/api/superadmin/overview', requireAuth, requireMinRole('ADMIN'), (_req, res) => {
  const users = db
    .prepare(`SELECT id, email, full_name, role, experience_level, kyc_status, two_factor_enabled, status, created_at FROM users ORDER BY created_at DESC`)
    .all();
  const markets = db.prepare(`SELECT * FROM markets`).all();
  const providers = db.prepare(`SELECT * FROM ai_providers ORDER BY priority ASC`).all();
  const transactions = db.prepare(`SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT 60`).all();
  const auditLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80`).all();
  const reportedMsgs = db.prepare(`SELECT * FROM chat_messages WHERE reported = 1 ORDER BY created_at DESC`).all();
  const configs = {
    branding: getConfig('branding', {}),
    demo_settings: getConfig('demo_settings', {}),
    quick_trading: mergeQuickTradeConfig(getConfig<Partial<QuickTradeConfig>>('quick_trading', {})),
    referral_settings: getConfig('referral_settings', {}),
    enabled_modules: getConfig('enabled_modules', {}),
  };

  const stats = {
    totalUsers: users.length,
    totalOrders: (db.prepare(`SELECT COUNT(*) as c FROM orders`).get() as { c: number }).c,
    openFutures: (db.prepare(`SELECT COUNT(*) as c FROM futures_positions WHERE status = 'OPEN'`).get() as { c: number }).c,
    activeBots: (db.prepare(`SELECT COUNT(*) as c FROM bots WHERE status = 'ACTIVE'`).get() as { c: number }).c,
    totalVolume24h: (db.prepare(`SELECT SUM(volume_24h) as s FROM markets`).get() as { s: number }).s || 0,
  };

  res.json({ users, markets, providers, transactions, auditLogs, reportedMsgs, configs, stats });
});

app.get('/api/superadmin/quick-trades', requireAuth, requireMinRole('ADMIN'), (req, res) => {
  settleExpiredQuickTradesNow();
  const rawEnv = String(req.query.env || 'ALL').toUpperCase();
  const baseSql = `
    SELECT qt.*, u.email as user_email, u.full_name as user_name
    FROM quick_trades qt
    LEFT JOIN users u ON u.id = qt.user_id
  `;
  const trades = (
    rawEnv === 'DEMO' || rawEnv === 'REAL'
      ? db.prepare(`${baseSql} WHERE qt.env = ? ORDER BY qt.created_at DESC LIMIT 250`).all(rawEnv)
      : db.prepare(`${baseSql} ORDER BY qt.created_at DESC LIMIT 250`).all()
  ) as Array<{
    env: string;
    status: string;
    amount: number;
    profit: number;
  }>;

  const summarize = (list: typeof trades) => {
    const settled = list.filter((t) => t.status !== 'ACTIVE' && t.status !== 'CANCELLED');
    const wins = settled.filter((t) => t.status === 'WON').length;
    const losses = settled.filter((t) => t.status === 'LOST').length;
    const draws = settled.filter((t) => t.status === 'DRAW').length;
    const cancelled = list.filter((t) => t.status === 'CANCELLED').length;
    const active = list.filter((t) => t.status === 'ACTIVE').length;
    const totalVolume = list.reduce((s, t) => s + Number(t.amount || 0), 0);
    const traderNetPnl = settled.reduce((s, t) => s + Number(t.profit || 0), 0);
    return {
      total: list.length,
      active,
      wins,
      losses,
      draws,
      cancelled,
      winRatePct: settled.length > 0 ? Number(((wins / settled.length) * 100).toFixed(2)) : 0,
      totalVolume: Number(totalVolume.toFixed(2)),
      traderNetPnl: Number(traderNetPnl.toFixed(2)),
    };
  };

  const allTrades = db.prepare(`SELECT env, status, amount, profit FROM quick_trades`).all() as typeof trades;
  const auditLogs = db
    .prepare(
      `SELECT * FROM audit_logs WHERE target = 'quick_trading' OR action LIKE 'QUICK_TRADE%' ORDER BY created_at DESC LIMIT 50`
    )
    .all();

  res.json({
    trades,
    stats: {
      global: summarize(allTrades),
      demo: summarize(allTrades.filter((t) => t.env === 'DEMO')),
      real: summarize(allTrades.filter((t) => t.env === 'REAL')),
    },
    auditLogs,
  });
});

app.get('/api/superadmin/quick-trades/export-csv', requireAuth, requireMinRole('ADMIN'), (req: AuthRequest, res) => {
  const rawEnv = String(req.query.env || 'ALL').toUpperCase();
  const baseSql = `
    SELECT qt.*, u.email as user_email
    FROM quick_trades qt
    LEFT JOIN users u ON u.id = qt.user_id
  `;
  const rows = (
    rawEnv === 'DEMO' || rawEnv === 'REAL'
      ? db.prepare(`${baseSql} WHERE qt.env = ? ORDER BY qt.created_at DESC LIMIT 2000`).all(rawEnv)
      : db.prepare(`${baseSql} ORDER BY qt.created_at DESC LIMIT 2000`).all()
  ) as Array<Record<string, unknown>>;

  logAudit(req.user!.id, req.user!.email, 'QUICK_TRADE_CSV_EXPORTED', `env=${rawEnv}`, `Exportadas ${rows.length} operaciones`);
  const csv = buildQuickTradesCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="superadmin-quick-trades-${rawEnv.toLowerCase()}.csv"`);
  res.send(csv);
});

app.patch('/api/superadmin/users/:userId', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const { role, status, kycStatus } = req.body as { role?: UserRole; status?: string; kycStatus?: string };
  if (role && ['USER', 'MODERATOR', 'SUPPORT', 'ADMIN', 'SUPERADMIN'].includes(role)) {
    db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, req.params.userId);
  }
  if (status && ['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
    db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, req.params.userId);
  }
  if (kycStatus && ['UNVERIFIED', 'PENDING', 'VERIFIED'].includes(kycStatus)) {
    db.prepare(`UPDATE users SET kyc_status = ? WHERE id = ?`).run(kycStatus, req.params.userId);
  }
  logAudit(req.user!.id, req.user!.email, 'USER_UPDATED', req.params.userId, JSON.stringify({ role, status, kycStatus }));
  res.json({ ok: true });
});

app.patch('/api/superadmin/config/:key', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const allowedKeys = ['branding', 'demo_settings', 'quick_trading', 'referral_settings', 'enabled_modules'];
  if (!allowedKeys.includes(req.params.key)) {
    res.status(400).json({ error: 'Clave de configuración inválida.' });
    return;
  }
  let payloadToStore: unknown = req.body;
  if (req.params.key === 'quick_trading') {
    const merged = mergeQuickTradeConfig(req.body as Partial<QuickTradeConfig>);
    payloadToStore = merged;
    if (merged.priceProvider === 'SIMULATED_FEED') {
      db.prepare(`UPDATE markets SET price_source = 'SIMULATED_FEED' WHERE is_custom_token = 0`).run();
    }
  }
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value_json) VALUES (?, ?)`).run(
    req.params.key,
    JSON.stringify(payloadToStore)
  );
  logAudit(req.user!.id, req.user!.email, 'CONFIG_UPDATED', req.params.key, JSON.stringify(payloadToStore));
  res.json({ ok: true });
});

app.post('/api/superadmin/markets', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const { symbol, basePrice, maxLeverage, makerFeeBps, takerFeeBps, spotEnabled, futuresEnabled } = req.body as {
    symbol?: string;
    basePrice?: number;
    maxLeverage?: number;
    makerFeeBps?: number;
    takerFeeBps?: number;
    spotEnabled?: boolean;
    futuresEnabled?: boolean;
  };
  if (!symbol || !symbol.includes('/') || !basePrice) {
    res.status(400).json({ error: 'Formato requerido: PAR/USDT y precio inicial.' });
    return;
  }
  const cleanSym = symbol.toUpperCase().trim();
  const [base, quote] = cleanSym.split('/');
  db.prepare(`
    INSERT OR REPLACE INTO markets (
      symbol, base, quote, base_price, last_price, high_24h, low_24h, change_24h, volume_24h,
      spread_bps, maker_fee_bps, taker_fee_bps, min_qty, price_precision, qty_precision,
      spot_enabled, futures_enabled, max_leverage, is_custom_token, liquidity_usdt, price_source, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 500000, 4, ?, ?, 0.001, ?, 3, ?, ?, ?, 0, 2000000, 'SIMULATED_FEED', 1)
  `).run(
    cleanSym,
    base,
    quote,
    basePrice,
    basePrice,
    basePrice * 1.03,
    basePrice * 0.97,
    makerFeeBps ?? 10,
    takerFeeBps ?? 10,
    basePrice < 5 ? 4 : 2,
    spotEnabled !== false ? 1 : 0,
    futuresEnabled !== false ? 1 : 0,
    Math.min(125, Math.max(1, maxLeverage || 50))
  );
  logAudit(req.user!.id, req.user!.email, 'MARKET_UPSERT', cleanSym, `Precio base: ${basePrice}, MaxLev: ${maxLeverage}`);
  res.json({ ok: true });
});

app.patch('/api/superadmin/markets/:base/:quote', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const symbol = `${req.params.base.toUpperCase()}/${req.params.quote.toUpperCase()}`;
  const { active, spotEnabled, futuresEnabled, maxLeverage, takerFeeBps } = req.body as {
    active?: boolean;
    spotEnabled?: boolean;
    futuresEnabled?: boolean;
    maxLeverage?: number;
    takerFeeBps?: number;
  };
  if (active !== undefined) db.prepare(`UPDATE markets SET active = ? WHERE symbol = ?`).run(active ? 1 : 0, symbol);
  if (spotEnabled !== undefined) db.prepare(`UPDATE markets SET spot_enabled = ? WHERE symbol = ?`).run(spotEnabled ? 1 : 0, symbol);
  if (futuresEnabled !== undefined) db.prepare(`UPDATE markets SET futures_enabled = ? WHERE symbol = ?`).run(futuresEnabled ? 1 : 0, symbol);
  if (maxLeverage !== undefined) db.prepare(`UPDATE markets SET max_leverage = ? WHERE symbol = ?`).run(Math.min(125, Math.max(1, maxLeverage)), symbol);
  if (takerFeeBps !== undefined) db.prepare(`UPDATE markets SET taker_fee_bps = ? WHERE symbol = ?`).run(takerFeeBps, symbol);

  logAudit(req.user!.id, req.user!.email, 'MARKET_MODIFIED', symbol, JSON.stringify(req.body));
  res.json({ ok: true });
});

app.patch('/api/superadmin/ai-providers/:providerId', requireAuth, requireMinRole('SUPERADMIN'), (req: AuthRequest, res) => {
  const { enabled, priority, model, maxRpm } = req.body as {
    enabled?: boolean;
    priority?: number;
    model?: string;
    maxRpm?: number;
  };
  if (enabled !== undefined) db.prepare(`UPDATE ai_providers SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, req.params.providerId);
  if (priority !== undefined) db.prepare(`UPDATE ai_providers SET priority = ? WHERE id = ?`).run(priority, req.params.providerId);
  if (model) db.prepare(`UPDATE ai_providers SET model = ? WHERE id = ?`).run(model.trim(), req.params.providerId);
  if (maxRpm !== undefined) db.prepare(`UPDATE ai_providers SET max_rpm = ? WHERE id = ?`).run(maxRpm, req.params.providerId);

  logAudit(req.user!.id, req.user!.email, 'AI_PROVIDER_UPDATED', req.params.providerId, JSON.stringify({ enabled, priority, model, maxRpm }));
  res.json({ ok: true });
});

app.patch('/api/superadmin/transactions/:txId', requireAuth, requireMinRole('ADMIN'), (req: AuthRequest, res) => {
  const { action } = req.body as { action?: 'APPROVE' | 'REJECT' };
  const txRow = db.prepare(`SELECT * FROM wallet_transactions WHERE id = ?`).get(req.params.txId) as
    | { id: string; user_id: string; env: string; type: string; asset: string; amount: number; status: string }
    | undefined;
  if (!txRow) {
    res.status(404).json({ error: 'Transacción no encontrada.' });
    return;
  }

  if (txRow.status !== 'PENDING' && txRow.status !== 'FLAGGED') {
    res.status(400).json({ error: 'Esta transacción ya fue conciliada.' });
    return;
  }

  const tx = db.transaction(() => {
    if (action === 'APPROVE') {
      db.prepare(`UPDATE wallet_transactions SET status = 'CONFIRMED' WHERE id = ?`).run(txRow.id);
      if (txRow.type === 'DEPOSIT') {
        db.prepare(`
          INSERT INTO wallets (id, user_id, env, asset, available, locked, addresses_json)
          VALUES (?, ?, ?, ?, ?, 0, '{}')
          ON CONFLICT(user_id, env, asset) DO UPDATE SET available = available + ?
        `).run(`${txRow.user_id}_${txRow.env}_${txRow.asset}`, txRow.user_id, txRow.env, txRow.asset, txRow.amount, txRow.amount);
      } else if (txRow.type === 'WITHDRAWAL') {
        db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?) WHERE user_id = ? AND env = ? AND asset = ?`).run(
          txRow.amount,
          txRow.user_id,
          txRow.env,
          txRow.asset
        );
      }
    } else if (action === 'REJECT') {
      db.prepare(`UPDATE wallet_transactions SET status = 'REJECTED' WHERE id = ?`).run(txRow.id);
      if (txRow.type === 'WITHDRAWAL') {
        db.prepare(`UPDATE wallets SET locked = MAX(0, locked - ?), available = available + ? WHERE user_id = ? AND env = ? AND asset = ?`).run(
          txRow.amount,
          txRow.amount,
          txRow.user_id,
          txRow.env,
          txRow.asset
        );
      }
    }
  });
  tx();

  logAudit(req.user!.id, req.user!.email, `TX_${action}`, txRow.id, `${txRow.type} ${txRow.amount} ${txRow.asset} (${txRow.env})`);
  res.json({ ok: true });
});

// ==========================================
// HTTP SERVER & WEBSOCKETS (SAME PORT 3000)
// ==========================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clientSessions = new Map<WebSocket, { userId?: string }>();

function broadcastWS(event: string, payload: unknown, targetUserId?: string) {
  const frame = JSON.stringify({ event, payload });
  for (const [ws, meta] of clientSessions.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (targetUserId && meta.userId !== targetUserId) continue;
    ws.send(frame);
  }
}

setBroadcastHandler(broadcastWS);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', 'http://localhost');
  const token = url.searchParams.get('token');
  const decoded = token ? verifyAuthToken(token) : null;
  clientSessions.set(ws, { userId: decoded?.id });

  ws.send(JSON.stringify({ event: 'ws:connected', payload: { onlineCount: clientSessions.size } }));

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as { event?: string; token?: string };
      if (parsed.event === 'auth' && parsed.token) {
        const u = verifyAuthToken(parsed.token);
        clientSessions.set(ws, { userId: u?.id });
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('close', () => {
    clientSessions.delete(ws);
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  startMarketEngine();

  server.listen(3000, '0.0.0.0', () => {
    console.log('CRYPTO AI EXCHANGE server listening on http://0.0.0.0:3000');
  });
}

startServer();
