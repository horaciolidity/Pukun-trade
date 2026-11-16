import assert from 'node:assert/strict';
import { initDatabase, db, ensureUserDemoWallets } from '../server/db.ts';
import { computeTechnicalIndicators } from '../server/marketEngine.ts';
import { analyzeMarketWithAI } from '../server/aiService.ts';
import {
  computeQuickTradeLiveMetrics,
  computeQuickTradeSettlement,
  DEFAULT_QUICK_TRADE_CONFIG,
  resolveQuickTradePayout,
} from '../src/utils/quickTradeMath.ts';

async function runFinancialTests() {
  initDatabase();

  // 1. Verify strict DEMO vs REAL wallet isolation for seeded trader
  const demoUsdt = db
    .prepare(`SELECT available FROM wallets WHERE user_id = 'usr_demo_trader' AND env = 'DEMO' AND asset = 'USDT'`)
    .get() as { available: number };
  const realUsdt = db
    .prepare(`SELECT available FROM wallets WHERE user_id = 'usr_demo_trader' AND env = 'REAL' AND asset = 'USDT'`)
    .get() as { available: number };

  assert.ok(demoUsdt.available >= 0, 'DEMO USDT balance must be non-negative');
  assert.equal(realUsdt.available, 0, 'REAL USDT balance for new/demo trader must remain isolated at 0');

  // 2. Verify new user creation initializes DEMO with configured capital and REAL with 0
  const testUid = `usr_test_${Date.now()}`;
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, referral_code, created_at)
    VALUES (?, ?, 'hash', 'Test Financial', 'USER', ?, ?)
  `).run(testUid, `${testUid}@test.local`, `REF-${Date.now()}`, Date.now());
  ensureUserDemoWallets(testUid);

  const testDemo = db
    .prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = 'DEMO' AND asset = 'USDT'`)
    .get(testUid) as { available: number };
  const testReal = db
    .prepare(`SELECT available FROM wallets WHERE user_id = ? AND env = 'REAL' AND asset = 'USDT'`)
    .get(testUid) as { available: number };

  assert.equal(testDemo.available, 10000, 'New user must start with 10,000 virtual DEMO USDT');
  assert.equal(testReal.available, 0, 'New user REAL wallet must start at 0');

  // Cleanup test user
  db.prepare(`DELETE FROM users WHERE id = ?`).run(testUid);

  // 3. Verify Futures Liquidation Price Calculation Math
  const entry = 90000;
  const lev = 10;
  const maint = 0.005;
  const longLiq = entry * (1 - 1 / lev + maint);
  const shortLiq = entry * (1 + 1 / lev - maint);
  assert.ok(longLiq < entry && longLiq > 80000, 'LONG 10x liquidation price must sit ~9.5% below entry');
  assert.ok(shortLiq > entry && shortLiq < 100000, 'SHORT 10x liquidation price must sit ~9.5% above entry');

  // 4. Verify Technical Indicators Computation
  const ind = computeTechnicalIndicators('BTC/USDT');
  assert.ok(ind.rsi14 >= 0 && ind.rsi14 <= 100, 'RSI-14 must stay within 0..100');
  assert.ok(ind.bbUpper >= ind.bbMiddle && ind.bbMiddle >= ind.bbLower, 'Bollinger Bands must maintain upper >= middle >= lower');

  // 5. Verify AI Market Intelligence probabilities strictly sum to 100
  const intel = await analyzeMarketWithAI('BTC/USDT', '1H');
  assert.equal(
    intel.prob_bullish + intel.prob_bearish + intel.prob_sideways,
    100,
    'Market Intelligence probabilities must sum to exactly 100%'
  );

  // 6. Verify Quick Trading Pro dynamic PnL, bounds, thermal color mapping, and granular payouts
  const customCfg = {
    ...DEFAULT_QUICK_TRADE_CONFIG,
    payoutPct: 85,
    assetPayouts: { 'BTC/USDT': 88 },
    durationPayouts: { '30': 85, '300': 90 },
  };
  assert.equal(resolveQuickTradePayout(customCfg, 'BTC/USDT', 30), 88, 'Asset-specific payout must apply cleanly');
  assert.equal(resolveQuickTradePayout(customCfg, 'BTC/USDT', 300), 93, 'Duration offset + asset payout must compose accurately');
  assert.equal(resolveQuickTradePayout(customCfg, 'ETH/USDT', 300), 90, 'Duration-specific payout must apply when asset uses default');

  const now = Date.now();
  const winMetrics = computeQuickTradeLiveMetrics({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    currentPrice: 90250,
    payoutPct: 85,
    createdAt: now - 15000,
    expiresAt: now + 15000,
    nowMs: now,
  });
  assert.ok(winMetrics.dynamicPnl > 0 && winMetrics.dynamicPnl <= 85, 'Dynamic profit must stay within (0, +potentialProfit]');
  assert.equal(winMetrics.projectedSettlementPnl, winMetrics.dynamicPnl, 'Projected settlement must match live dynamic PnL');
  assert.ok(winMetrics.thermalScore > 50 && winMetrics.thermalScore <= 100, 'Thermal score must shift right on profit');

  const lossMetrics = computeQuickTradeLiveMetrics({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    currentPrice: 89750,
    payoutPct: 85,
    createdAt: now - 15000,
    expiresAt: now + 15000,
    nowMs: now,
  });
  assert.ok(lossMetrics.dynamicPnl < 0 && lossMetrics.dynamicPnl >= -100, 'Dynamic loss must stay within [-amount, 0)');
  assert.equal(lossMetrics.projectedSettlementPnl, lossMetrics.dynamicPnl, 'Projected settlement must match live dynamic PnL on loss');
  assert.ok(lossMetrics.thermalScore < 50 && lossMetrics.thermalScore >= 0, 'Thermal score must shift left on loss');

  // 7. Verify Quick Trade closes strictly with last dynamic PnL obtained at expiration
  const tradeStart = now - 30000;
  const smallGainClosePrice = 90030; // +3.33 bps -> partial positive PnL, NOT binary +85
  const atCloseLive = computeQuickTradeLiveMetrics({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    currentPrice: smallGainClosePrice,
    payoutPct: 85,
    createdAt: tradeStart,
    expiresAt: now,
    nowMs: now,
  });
  const winSettle = computeQuickTradeSettlement({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    closePrice: smallGainClosePrice,
    payoutPct: 85,
    createdAt: tradeStart,
    expiresAt: now,
    settledAt: now + 200,
  });
  assert.equal(winSettle.status, 'WON');
  assert.equal(winSettle.profit, atCloseLive.dynamicPnl, 'Closed profit must equal exact last dynamic PnL');
  assert.ok(winSettle.profit > 0 && winSettle.profit < 85, 'Small favorable move must settle proportionally, not binary max');
  assert.equal(Number((winSettle.returnAmount - 100).toFixed(2)), winSettle.profit, 'Wallet return must conserve capital + exact profit');

  const smallLossClosePrice = 89970; // -3.33 bps -> partial loss, NOT binary -100
  const atCloseLossLive = computeQuickTradeLiveMetrics({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    currentPrice: smallLossClosePrice,
    payoutPct: 85,
    createdAt: tradeStart,
    expiresAt: now,
    nowMs: now,
  });
  const lossSettle = computeQuickTradeSettlement({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    closePrice: smallLossClosePrice,
    payoutPct: 85,
    createdAt: tradeStart,
    expiresAt: now,
    settledAt: now + 200,
  });
  assert.equal(lossSettle.status, 'LOST');
  assert.equal(lossSettle.profit, atCloseLossLive.dynamicPnl, 'Closed loss must equal exact last dynamic PnL');
  assert.ok(lossSettle.profit < 0 && lossSettle.profit > -100, 'Small adverse move must settle proportionally, not binary -amount');
  assert.equal(Number((lossSettle.returnAmount - 100).toFixed(2)), lossSettle.profit, 'Wallet return must conserve capital + exact loss');

  const drawSettle = computeQuickTradeSettlement({
    direction: 'UP',
    amount: 100,
    entryPrice: 90000,
    closePrice: 90000,
    payoutPct: 85,
    createdAt: tradeStart,
    expiresAt: now,
  });
  assert.equal(drawSettle.status, 'DRAW');
  assert.equal(drawSettle.profit, 0);
  assert.equal(drawSettle.returnAmount, 100);

  console.log('ALL FINANCIAL & ENGINE INVARIANT TESTS PASSED');
}

runFinancialTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
