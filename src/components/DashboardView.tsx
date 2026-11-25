import { ArrowUpRight, ArrowDownRight, Bot, Wallet, Star, Zap, BookOpen, TrendingUp, Rocket, Sparkles } from 'lucide-react';
import { formatCurrency, formatPrice } from '../api';
import {
  ExperienceLevel,
  FuturesPosition,
  LiveSignal,
  Market,
  NavSection,
  SpotOrder,
  TradingBot,
  TradingEnv,
  WalletItem,
} from '../types';

interface Props {
  env: TradingEnv;
  experience: ExperienceLevel;
  markets: Market[];
  favorites: string[];
  wallets: WalletItem[];
  walletSummary: { totalUsdt: number; availableUsdt: number; lockedUsdt: number };
  orders: SpotOrder[];
  positions: FuturesPosition[];
  bots: TradingBot[];
  signals: LiveSignal[];
  onNavigate: (tab: NavSection, symbol?: string, presetSide?: 'BUY' | 'SELL') => void;
  onToggleFavorite: (symbol: string) => void;
  onResetDemo: () => void;
}

export function DashboardView({
  env,
  experience,
  markets,
  favorites,
  walletSummary,
  orders,
  positions,
  bots,
  signals,
  onNavigate,
  onToggleFavorite,
  onResetDemo,
}: Props) {
  const openOrders = orders.filter((o) => o.status === 'OPEN');
  const openPositions = positions.filter((p) => p.status === 'OPEN');
  const activeBots = bots.filter((b) => b.status === 'ACTIVE');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startMs = todayStart.getTime();

  const realizedToday = positions
    .filter((p) => p.status !== 'OPEN' && p.closed_at >= startMs)
    .reduce((acc, p) => acc + p.realized_pnl, 0);
  const botsPnl = bots.reduce((acc, b) => acc + b.pnl, 0);

  const unrealizedPnl = openPositions.reduce((acc, p) => {
    const m = markets.find((mk) => mk.symbol === p.market_symbol);
    if (!m) return acc;
    const diff = p.side === 'LONG' ? (m.last_price - p.entry_price) * p.qty : (p.entry_price - m.last_price) * p.qty;
    return acc + diff;
  }, 0);

  const dailyNet = realizedToday + unrealizedPnl;
  const dailyGain = Math.max(0, dailyNet) + Math.max(0, botsPnl);
  const dailyLoss = Math.abs(Math.min(0, dailyNet));
  const roiPct = env === 'DEMO' ? ((walletSummary.totalUsdt - 10000) / 10000) * 100 : 0;

  const favMarkets = markets.filter((m) => favorites.includes(m.symbol));
  const displayMarkets = favMarkets.length > 0 ? favMarkets : markets.slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Pukun Trade Ancestral-Tech Welcome Banner */}
      <div className="relative rounded-2xl border border-amber-500/25 overflow-hidden bg-[#111520]">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 pointer-events-none"
          style={{ backgroundImage: "url('/hero-bg.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#090B10]/95 via-[#090B10]/75 to-transparent pointer-events-none" />
        <div className="relative p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/logo.png"
              alt="Pukun Trade"
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl border border-amber-400/40 shadow-lg shadow-amber-500/15 object-cover shrink-0"
            />
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
                <Sparkles className="h-3 w-3 text-cyan-400" />
                <span>Pukun Trade · Ancestral Tech Exchange</span>
              </div>
              <h1 className="font-display text-lg sm:text-xl font-bold text-white">
                Centro de Operaciones Inteligentes ({env})
              </h1>
              <p className="text-xs text-slate-300 max-w-xl">
                Accede a todos los módulos del ecosistema: Spot, Futuros 125x, Quick Trading, 7 Bots IA, Señales en Vivo, Wallet Multi-Red y Launchpad.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('quick-trade')}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:brightness-110 transition-all cursor-pointer"
            >
              Probar Quick Trade
            </button>
            <button
              type="button"
              onClick={() => onNavigate('signals')}
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer"
            >
              Ver Señales IA
            </button>
          </div>
        </div>
      </div>

      {/* Beginner Guidance Strip */}
      {experience === 'BEGINNER' && (
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/8 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-300">
              <BookOpen className="h-4 w-4" />
              <span>Modo Principiante Activo — Empieza paso a paso sin riesgo</span>
            </div>
            <p className="text-xs text-slate-300">
              Tienes capital virtual en DEMO. Prueba comprar BTC en Modo Sencillo o activa un bot preconfigurado antes de explorar Futuros.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('academy')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Abrir Tutoriales
          </button>
        </div>
      )}

      {/* Portfolio KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="rounded-xl border border-white/10 bg-[#111520] p-4 sm:col-span-2 xl:col-span-1">
          <div className="text-xs text-slate-400">Balance Total ({env})</div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-white tabular-nums">
            ${formatCurrency(walletSummary.totalUsdt)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {env === 'DEMO' ? 'Capital virtual no retirable' : 'Fondos reales en custodia'}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Balance Disponible</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-slate-100 tabular-nums">
            ${formatCurrency(walletSummary.availableUsdt)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Bloqueado: ${formatCurrency(walletSummary.lockedUsdt)}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Ganancias del Día</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
            +${formatCurrency(dailyGain)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Operaciones + Bots</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Pérdidas del Día</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-red-400 tabular-nums">
            -${formatCurrency(dailyLoss)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Exposición abierta actual</div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Rentabilidad Acumulada</div>
          <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {roiPct >= 0 ? '+' : ''}
            {roiPct.toFixed(2)}%
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {env === 'DEMO' ? (
              <button type="button" onClick={onResetDemo} className="text-blue-400 hover:underline cursor-pointer">
                Restablecer DEMO
              </button>
            ) : (
              'Cuenta REAL'
            )}
          </div>
        </div>
      </div>

      {/* 4 Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('spot', 'BTC/USDT', 'BUY')}
          className="flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-left hover:bg-emerald-500/15 transition-colors cursor-pointer"
        >
          <div>
            <div className="text-sm font-semibold text-emerald-300">COMPRAR CRYPTO</div>
            <div className="text-xs text-slate-400 mt-0.5">Spot inmediato</div>
          </div>
          <ArrowUpRight className="h-5 w-5 text-emerald-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('spot', 'BTC/USDT', 'SELL')}
          className="flex items-center justify-between rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-left hover:bg-red-500/15 transition-colors cursor-pointer"
        >
          <div>
            <div className="text-sm font-semibold text-red-300">VENDER CRYPTO</div>
            <div className="text-xs text-slate-400 mt-0.5">Liquidar a USDT</div>
          </div>
          <ArrowDownRight className="h-5 w-5 text-red-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('bots')}
          className="flex items-center justify-between rounded-xl border border-blue-500/25 bg-blue-500/10 p-4 text-left hover:bg-blue-500/15 transition-colors cursor-pointer"
        >
          <div>
            <div className="text-sm font-semibold text-blue-300">USAR BOTS IA</div>
            <div className="text-xs text-slate-400 mt-0.5">{activeBots.length} activos ahora</div>
          </div>
          <Bot className="h-5 w-5 text-blue-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('wallet')}
          className="flex items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/10 p-4 text-left hover:bg-violet-500/15 transition-colors cursor-pointer"
        >
          <div>
            <div className="text-sm font-semibold text-violet-300">DEPOSITAR</div>
            <div className="text-xs text-slate-400 mt-0.5">Billetera multi-red</div>
          </div>
          <Wallet className="h-5 w-5 text-violet-400 shrink-0" />
        </button>
      </div>

      {/* Marketing Visual Banner Cards — Explore All Modules */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-white">
              Explora y Prueba Todos los Módulos de Pukun Trade
            </h2>
            <p className="text-[11px] text-slate-400">
              Selecciona cualquier carta para ir directo a operar o probar la herramienta
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            {
              title: 'Spot, Futuros 125x & Quick',
              badge: 'TRADING PRO',
              desc: 'Gráficos TradingView, perpetuos hasta 125x y rondas rápidas de 15s a 5m.',
              img: '/banner-trading.jpg',
              cta: 'Ir a Futuros',
              target: 'futures' as NavSection,
              secondaryCta: 'Quick Trade',
              secondaryTarget: 'quick-trade' as NavSection,
              icon: TrendingUp,
              badgeClass: 'text-emerald-300 bg-emerald-500/20 border-emerald-400/30',
            },
            {
              title: '7 Bots IA & Señales en Vivo',
              badge: 'IA CUANTITATIVA',
              desc: 'Automatiza Scalping, Grid, DCA y análisis probabilístico con Gemini.',
              img: '/banner-bots.jpg',
              cta: 'Abrir Bots IA',
              target: 'bots' as NavSection,
              secondaryCta: 'Market Intel',
              secondaryTarget: 'market-intel' as NavSection,
              icon: Bot,
              badgeClass: 'text-cyan-300 bg-cyan-500/20 border-cyan-400/30',
            },
            {
              title: 'Wallet Multi-Red Segura',
              badge: '9 BLOCKCHAINS',
              desc: 'Direcciones BTC, ETH, SOL, BNB, Polygon y Tron con saldo DEMO/REAL aislado.',
              img: '/banner-wallet.jpg',
              cta: 'Ver Wallet',
              target: 'wallet' as NavSection,
              secondaryCta: 'Referidos',
              secondaryTarget: 'referrals' as NavSection,
              icon: Wallet,
              badgeClass: 'text-amber-300 bg-amber-500/20 border-amber-400/30',
            },
            {
              title: 'Launchpad & Comunidad',
              badge: 'WEB3 & CRECIMIENTO',
              desc: 'Nuevos tokens, rankings DEMO, chat en vivo y programa de comisiones.',
              img: '/banner-launchpad.jpg',
              cta: 'Ir a Launchpad',
              target: 'launchpad' as NavSection,
              secondaryCta: 'Competencias',
              secondaryTarget: 'competitions' as NavSection,
              icon: Rocket,
              badgeClass: 'text-violet-300 bg-violet-500/20 border-violet-400/30',
            },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="group rounded-2xl border border-white/10 bg-[#111520] overflow-hidden hover:border-amber-400/40 transition-all flex flex-col shadow-lg"
              >
                <div className="relative h-32 overflow-hidden">
                  <img
                    src={card.img}
                    alt={card.title}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#111520] via-[#111520]/40 to-transparent" />
                  <span
                    className={`absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wider backdrop-blur-md ${card.badgeClass}`}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {card.badge}
                  </span>
                </div>
                <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <h3 className="font-display text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{card.desc}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-white/8">
                    <button
                      type="button"
                      onClick={() => onNavigate(card.target)}
                      className="flex-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 py-1.5 text-[11px] font-semibold text-amber-300 transition-colors cursor-pointer"
                    >
                      {card.cta}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate(card.secondaryTarget)}
                      className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors cursor-pointer"
                    >
                      {card.secondaryCta}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Favorite Cryptos & Market Trends */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-xl border border-white/10 bg-[#111520]">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8">
              <h2 className="font-display text-sm font-semibold text-white">Criptomonedas Favoritas & Tendencias</h2>
              <button
                type="button"
                onClick={() => onNavigate('markets')}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Ver todos los mercados
              </button>
            </div>
            <div className="divide-y divide-white/6">
              {displayMarkets.map((m) => (
                <div key={m.symbol} className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(m.symbol)}
                      aria-label={`Alternar favorito ${m.symbol}`}
                      className="text-amber-400 hover:scale-110 transition-transform cursor-pointer"
                    >
                      <Star className={`h-4 w-4 ${favorites.includes(m.symbol) ? 'fill-amber-400' : 'text-slate-600'}`} />
                    </button>
                    <div>
                      <div className="text-sm font-semibold text-white">{m.symbol}</div>
                      <div className="text-[11px] text-slate-500">Vol 24h: ${formatCurrency(m.volume_24h / 1000000, 1)}M</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-sm font-medium text-white">${formatPrice(m.last_price)}</div>
                      <div className={`text-xs ${m.change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {m.change_24h >= 0 ? '+' : ''}
                        {m.change_24h.toFixed(2)}%
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('spot', m.symbol)}
                      className="rounded-lg border border-white/10 bg-[#181E2E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#222B42] cursor-pointer"
                    >
                      Operar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Open Positions & Orders Summary */}
          <div className="rounded-xl border border-white/10 bg-[#111520]">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8">
              <h2 className="font-display text-sm font-semibold text-white">
                Operaciones Abiertas ({openOrders.length} Spot · {openPositions.length} Futuros)
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('futures')}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Ir a Futuros
              </button>
            </div>
            {openOrders.length === 0 && openPositions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No tienes órdenes límite ni posiciones abiertas en {env}. Usa Comprar Crypto o Quick Trading para comenzar.
              </div>
            ) : (
              <div className="divide-y divide-white/6">
                {openPositions.slice(0, 4).map((p) => {
                  const m = markets.find((mk) => mk.symbol === p.market_symbol);
                  const livePnl = m
                    ? p.side === 'LONG'
                      ? (m.last_price - p.entry_price) * p.qty
                      : (p.entry_price - m.last_price) * p.qty
                    : 0;
                  return (
                    <div key={p.id} className="flex items-center justify-between px-4 py-3 text-xs">
                      <div>
                        <span className={`font-semibold ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {p.side} {p.leverage}x
                        </span>
                        <span className="ml-2 text-white font-medium">{p.market_symbol}</span>
                        <div className="text-slate-500 mt-0.5 font-mono">
                          Entrada ${formatPrice(p.entry_price)} · Liq ${formatPrice(p.liq_price)}
                        </div>
                      </div>
                      <div className={`font-mono font-semibold tabular-nums ${livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {livePnl >= 0 ? '+' : ''}
                        {livePnl.toFixed(2)} USDT
                      </div>
                    </div>
                  );
                })}
                {openOrders.slice(0, 4).map((o) => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-3 text-xs">
                    <div>
                      <span className={o.side === 'BUY' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                        {o.side} {o.type}
                      </span>
                      <span className="ml-2 text-white">{o.market_symbol}</span>
                    </div>
                    <div className="font-mono text-slate-300 tabular-nums">
                      {o.qty} @ ${formatPrice(o.price)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Active Bots & Latest Signals */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-white/10 bg-[#111520]">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8">
              <h2 className="font-display text-sm font-semibold text-white">Bots Activos ({activeBots.length})</h2>
              <button
                type="button"
                onClick={() => onNavigate('bots')}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Galería de Bots
              </button>
            </div>
            <div className="divide-y divide-white/6">
              {(activeBots.length > 0 ? activeBots : bots.slice(0, 3)).map((b) => (
                <div key={b.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <div>
                    <div className="font-semibold text-white">{b.name}</div>
                    <div className="text-slate-500 mt-0.5">
                      {b.symbol} · {b.status === 'ACTIVE' ? 'En ejecución DEMO' : b.status}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className={b.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {b.pnl >= 0 ? '+' : ''}
                      {b.pnl.toFixed(2)} USDT
                    </div>
                    <div className="text-slate-500">{b.trades_count} ops</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111520]">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8">
              <h2 className="font-display text-sm font-semibold text-white">Últimas Señales IA</h2>
              <button
                type="button"
                onClick={() => onNavigate('signals')}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Centro de Señales
              </button>
            </div>
            <div className="divide-y divide-white/6">
              {signals.slice(0, 4).map((s) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-blue-400" />
                      <span className="font-semibold text-white">{s.symbol}</span>
                      <span className={s.direction === 'LONG' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                        {s.direction}
                      </span>
                      <span className="text-slate-500">· {s.timeframe}</span>
                    </div>
                    <div className="text-slate-500 mt-0.5 font-mono">
                      SL ${formatPrice(s.stop_loss)} · TP ${formatPrice(s.take_profit)}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-blue-300 font-semibold">{s.confidence}% conf.</div>
                    <div className="text-slate-500">{s.outcome}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
