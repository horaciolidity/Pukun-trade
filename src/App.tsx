import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  LineChart,
  CandlestickChart as CandleIcon,
  Zap,
  Bot,
  Cpu,
  Wallet,
  Layers,
  Rocket,
  Users,
  Trophy,
  BookOpen,
  Settings,
  ShieldCheck,
  Bell,
  LogOut,
  Menu,
  X,
  TrendingUp,
  Gift,
  RotateCcw,
} from 'lucide-react';
import { apiFetch, getStoredToken, setStoredToken } from './api';
import {
  AppNotification,
  ChatMessage,
  CustomToken,
  FuturesPosition,
  LiveSignal,
  Market,
  NavSection,
  SpotOrder,
  TradingBot,
  TradingEnv,
  UserProfile,
  WalletItem,
  WalletTransaction,
} from './types';
import { LandingAuth } from './components/LandingAuth';
import { DEFAULT_MARKETS } from './defaultMarkets';
import { getCurrentSupabaseUser, isSupabaseConfigured, supabase, createDemoWallets } from './supabase';
import { DashboardView } from './components/DashboardView';
import { MarketsView } from './components/MarketsView';
import { SpotExchangeView } from './components/SpotExchangeView';
import { FuturesView } from './components/FuturesView';
import { QuickTradingView } from './components/QuickTradingView';
import { BotsView } from './components/BotsView';
import { SignalsAndIntelView } from './components/SignalsAndIntelView';
import { WalletView } from './components/WalletView';
import { TokenFactoryView } from './components/TokenFactoryView';
import { CommunityAndGrowthView } from './components/CommunityAndGrowthView';
import { ProfileSecurityView } from './components/ProfileSecurityView';
import { SuperadminView } from './components/SuperadminView';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [env, setEnv] = useState<TradingEnv>('DEMO');
  const [activeTab, setActiveTab] = useState<NavSection>('dashboard');
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/USDT');
  const [presetSpotSide, setPresetSpotSide] = useState<'BUY' | 'SELL' | undefined>(undefined);

  const [markets, setMarkets] = useState<Market[]>([]);
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [walletSummary, setWalletSummary] = useState({ totalUsdt: 0, availableUsdt: 0, lockedUsdt: 0 });
  const [walletTxs, setWalletTxs] = useState<WalletTransaction[]>([]);
  const [whitelist, setWhitelist] = useState<Array<{ id: string; asset: string; network: string; address: string; label: string }>>([]);
  const [orders, setOrders] = useState<SpotOrder[]>([]);
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [bots, setBots] = useState<TradingBot[]>([]);
  const [botTemplates, setBotTemplates] = useState<TradingBot[]>([]);
  const [signals, setSignals] = useState<LiveSignal[]>([]);
  const [tokens, setTokens] = useState<CustomToken[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({});
  const [brandingName, setBrandingName] = useState('CRYPTO AI EXCHANGE');

  const [notifOpen, setNotifOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [wsLatestChat, setWsLatestChat] = useState<ChatMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadPublicData = useCallback(async () => {
    try {
      const [mktRes, bootRes, sigRes, tokRes] = await Promise.all([
        apiFetch<{ markets: Market[] }>('/api/markets').catch(() => null),
        apiFetch<{ branding: { name?: string }; modules: Record<string, boolean> }>('/api/bootstrap').catch(() => null),
        apiFetch<{ signals: LiveSignal[] }>('/api/signals').catch(() => null),
        apiFetch<{ tokens: CustomToken[] }>('/api/tokens').catch(() => null),
      ]);
      if (Array.isArray(mktRes?.markets) && mktRes.markets.length > 0) {
        setMarkets(mktRes.markets);
      } else {
        setMarkets(DEFAULT_MARKETS);
      }
      if (bootRes?.modules && typeof bootRes.modules === 'object') setEnabledModules(bootRes.modules);
      if (bootRes?.branding?.name) setBrandingName(bootRes.branding.name);
      if (Array.isArray(sigRes?.signals)) setSignals(sigRes.signals);
      if (Array.isArray(tokRes?.tokens)) setTokens(tokRes.tokens);
    } catch {
      setMarkets(DEFAULT_MARKETS);
    }

    // Direct Binance ticker sync for live market prices
    try {
      const symbolsParam = '["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","ADAUSDT","DOGEUSDT"]';
      const bRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`);
      if (bRes.ok) {
        const tickers = (await bRes.json()) as Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
          highPrice: string;
          lowPrice: string;
          volume: string;
        }>;
        setMarkets((prev) =>
          (prev.length > 0 ? prev : DEFAULT_MARKETS).map((m) => {
            const clean = m.symbol.replace('/', '');
            const t = tickers.find((x) => x.symbol === clean);
            if (!t) return m;
            return {
              ...m,
              last_price: parseFloat(t.lastPrice),
              change_24h: parseFloat(t.priceChangePercent),
              high_24h: parseFloat(t.highPrice),
              low_24h: parseFloat(t.lowPrice),
              volume_24h: parseFloat(t.volume),
            };
          })
        );
      }
    } catch {
      // offline / blocked network fallback
    }
  }, []);

  const loadUserEnvData = useCallback(async (targetEnv: TradingEnv) => {
    if (!getStoredToken()) return;
    try {
      const [wRes, oRes, fRes, bRes, nRes] = await Promise.all([
        apiFetch<{
          wallets: WalletItem[];
          summary: { totalUsdt: number; availableUsdt: number; lockedUsdt: number };
          transactions: WalletTransaction[];
          whitelist: Array<{ id: string; asset: string; network: string; address: string; label: string }>;
        }>(`/api/wallet?env=${targetEnv}`).catch(() => null),
        apiFetch<{ orders: SpotOrder[] }>(`/api/spot/orders?env=${targetEnv}`).catch(() => null),
        apiFetch<{ positions: FuturesPosition[] }>(`/api/futures/positions?env=${targetEnv}`).catch(() => null),
        apiFetch<{ bots: TradingBot[]; templates: TradingBot[] }>(`/api/bots?env=${targetEnv}`).catch(() => null),
        apiFetch<{ notifications: AppNotification[] }>('/api/notifications').catch(() => null),
      ]);

      if (Array.isArray(wRes?.wallets) && wRes.wallets.length > 0) {
        setWallets(wRes.wallets);
        if (wRes?.summary) setWalletSummary(wRes.summary);
      } else {
        // Fallback demo wallets for smooth Vercel/Supabase experience
        const fallbackWallets: WalletItem[] = [
          { id: 'w1', user_id: user?.id || 'usr_demo', env: targetEnv, asset: 'USDT', available: 10000, locked: 0, addresses_json: '{}' },
          { id: 'w2', user_id: user?.id || 'usr_demo', env: targetEnv, asset: 'BTC', available: 0.25, locked: 0, addresses_json: '{}' },
          { id: 'w3', user_id: user?.id || 'usr_demo', env: targetEnv, asset: 'ETH', available: 2.5, locked: 0, addresses_json: '{}' },
          { id: 'w4', user_id: user?.id || 'usr_demo', env: targetEnv, asset: 'SOL', available: 15, locked: 0, addresses_json: '{}' },
          { id: 'w5', user_id: user?.id || 'usr_demo', env: targetEnv, asset: 'CAIX', available: 500, locked: 0, addresses_json: '{}' },
        ];
        setWallets(fallbackWallets);
        setWalletSummary({ totalUsdt: 10000, availableUsdt: 10000, lockedUsdt: 0 });
      }

      setWalletTxs(Array.isArray(wRes?.transactions) ? wRes.transactions : []);
      setWhitelist(Array.isArray(wRes?.whitelist) ? wRes.whitelist : []);
      setOrders(Array.isArray(oRes?.orders) ? oRes.orders : []);
      setPositions(Array.isArray(fRes?.positions) ? fRes.positions : []);
      setBots(Array.isArray(bRes?.bots) ? bRes.bots : []);
      setBotTemplates(Array.isArray(bRes?.templates) ? bRes.templates : []);
      setNotifications(Array.isArray(nRes?.notifications) ? nRes.notifications : []);
    } catch {
      // ignore
    }
  }, [user?.id]);

  useEffect(() => {
    async function init() {
      await loadPublicData();

      // Check Supabase session first
      if (isSupabaseConfigured()) {
        const sbUser = await getCurrentSupabaseUser();
        if (sbUser) {
          setUser(sbUser);
          setBooting(false);
          return;
        }
      }

      const token = getStoredToken();
      if (token) {
        try {
          const me = await apiFetch<{ user: UserProfile }>('/api/auth/me');
          if (me?.user?.id) {
            setUser(me.user);
          } else {
            setStoredToken('');
          }
        } catch {
          // If token was set for demo trader, maintain session
          if (token === 'demo_token_trader') {
            setUser({
              id: 'usr_demo_trader',
              email: 'trader@cryptoai.demo',
              full_name: 'Demo Trader Pro',
              avatar_url: '',
              role: 'USER',
              experience_level: 'PRO',
              two_factor_enabled: 0,
              email_verified: 1,
              kyc_status: 'VERIFIED',
              referral_code: 'REFTRADER',
              favorites: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
              notificationPrefs: { signals: true, orders: true, bots: true, security: true, community: true },
              status: 'ACTIVE',
              created_at: Math.floor(Date.now() / 1000),
            });
          } else {
            setStoredToken('');
          }
        }
      }
      setBooting(false);
    }
    init();
  }, [loadPublicData]);

  useEffect(() => {
    if (user?.id) {
      loadUserEnvData(env);
    }
  }, [user?.id, env, loadUserEnvData]);

  // WebSocket or Live Polling connection
  useEffect(() => {
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    // When deployed on Vercel without custom WS server, poll Binance every 10s instead of failing WS
    const isVercelHost = typeof window !== 'undefined' && window.location.hostname.endsWith('vercel.app');
    if (isVercelHost) {
      const interval = setInterval(async () => {
        try {
          const symbolsParam = '["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","ADAUSDT","DOGEUSDT"]';
          const bRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`);
          if (bRes.ok) {
            const tickers = (await bRes.json()) as Array<{
              symbol: string;
              lastPrice: string;
              priceChangePercent: string;
              highPrice: string;
              lowPrice: string;
            }>;
            setMarkets((prev) =>
              prev.map((m) => {
                const clean = m.symbol.replace('/', '');
                const t = tickers.find((x) => x.symbol === clean);
                if (!t) return m;
                return {
                  ...m,
                  last_price: parseFloat(t.lastPrice),
                  change_24h: parseFloat(t.priceChangePercent),
                  high_24h: parseFloat(t.highPrice),
                  low_24h: parseFloat(t.lowPrice),
                };
              })
            );
          }
        } catch {
          // ignore
        }
      }, 10000);
      return () => clearInterval(interval);
    }

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getStoredToken();
      const ws = new WebSocket(`${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { event: string; payload: unknown };
          if (msg.event === 'market:ticks' && Array.isArray(msg.payload)) {
            const updates = msg.payload as Array<{
              symbol: string;
              last_price: number;
              change_24h: number;
              high_24h: number;
              low_24h: number;
              price_source: string;
            }>;
            setMarkets((prev) =>
              (Array.isArray(prev) ? prev : []).map((m) => {
                const u = updates.find((x) => x.symbol === m.symbol);
                return u ? { ...m, ...u } : m;
              })
            );
          } else if (msg.event === 'chat:message' && msg.payload) {
            setWsLatestChat(msg.payload as ChatMessage);
          } else if (msg.event === 'notification:new' && msg.payload) {
            const n = msg.payload as AppNotification;
            setNotifications((prev) => [n, ...(Array.isArray(prev) ? prev : [])]);
          } else if (msg.event === 'signal:new' && msg.payload) {
            const s = msg.payload as LiveSignal;
            setSignals((prev) => [s, ...(Array.isArray(prev) ? prev : [])]);
          } else if (
            msg.event === 'wallet:updated' ||
            msg.event === 'futures:updated' ||
            msg.event === 'quicktrade:settled' ||
            msg.event === 'bots:updated'
          ) {
            loadUserEnvData(env);
          }
        } catch {
          // ignore malformed WS frame
        }
      };

      ws.onclose = () => {
        if (!closedByEffect) {
          reconnectTimer = setTimeout(connect, 3500);
        }
      };
    }

    connect();
    return () => {
      closedByEffect = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [user?.id, env, loadUserEnvData]);

  function handleNavigate(tab: NavSection, symbol?: string, presetSide?: 'BUY' | 'SELL') {
    if (symbol) setSelectedSymbol(symbol);
    setPresetSpotSide(presetSide);
    setActiveTab(tab);
    setMoreSheetOpen(false);
  }

  async function handleToggleFavorite(symbol: string) {
    if (!user) return;
    const res = await apiFetch<{ favorites: string[] }>('/api/markets/favorite', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    });
    setUser({ ...user, favorites: res.favorites });
  }

  async function handleResetDemo() {
    await apiFetch('/api/wallet/demo/reset', { method: 'POST' });
    loadUserEnvData('DEMO');
  }

  async function handleMarkNotificationsRead() {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => (Array.isArray(prev) ? prev : []).map((n) => ({ ...n, read: 1 })));
  }

  function handleLogout() {
    setStoredToken('');
    setUser(null);
    setActiveTab('dashboard');
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-[#090B10] flex items-center justify-center text-xs text-slate-400">
        Inicializando CRYPTO AI EXCHANGE...
      </div>
    );
  }

  if (!user) {
    return (
      <LandingAuth
        markets={markets}
        onAuthenticated={(u) => {
          setUser(u);
          setEnv('DEMO');
          setActiveTab('dashboard');
        }}
      />
    );
  }

  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const unreadCount = safeNotifications.filter((n) => n && n.read === 0).length;
  const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(user.role);

  const rawSidebarItems: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard; modKey?: string }> = [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
    { id: 'markets', label: 'Mercados', icon: LineChart },
    { id: 'spot', label: 'Exchange Spot', icon: CandleIcon, modKey: 'spot' },
    { id: 'futures', label: 'Futuros 125x', icon: TrendingUp, modKey: 'futures' },
    { id: 'quick-trade', label: 'Quick Trading', icon: Zap, modKey: 'quickTrading' },
    { id: 'bots', label: 'Bots IA', icon: Bot, modKey: 'bots' },
    { id: 'signals', label: 'Señales en Vivo', icon: Zap, modKey: 'signals' },
    { id: 'market-intel', label: 'Market Intel IA', icon: Cpu, modKey: 'marketIntel' },
    { id: 'wallet', label: 'Wallet', icon: Wallet, modKey: 'wallet' },
    { id: 'launchpad', label: 'Launchpad', icon: Rocket, modKey: 'launchpad' },
    ...(user.role === 'SUPERADMIN' ? [{ id: 'token-factory' as NavSection, label: 'Token Factory', icon: Layers, modKey: 'tokenFactory' }] : []),
    { id: 'referrals', label: 'Referidos', icon: Gift, modKey: 'referrals' },
    { id: 'community', label: 'Chat & Comunidad', icon: Users, modKey: 'community' },
    { id: 'competitions', label: 'Competencias DEMO', icon: Trophy, modKey: 'competitions' },
    { id: 'academy', label: 'Academia', icon: BookOpen, modKey: 'academy' },
    { id: 'profile', label: 'Perfil & Seguridad', icon: Settings },
    ...(isAdmin ? [{ id: 'superadmin' as NavSection, label: 'Superadmin', icon: ShieldCheck }] : []),
  ];
  const sidebarItems = rawSidebarItems.filter((item) => !item.modKey || enabledModules[item.modKey] !== false);

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-60 xl:w-64 flex-col border-r border-white/8 bg-[#0C0F17] sticky top-0 h-screen shrink-0">
        <div className="px-5 py-4 border-b border-white/8">
          <div className="font-display text-base font-bold tracking-tight text-white truncate">{brandingName}</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                  active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/8 text-xs space-y-2">
          <div className="rounded-lg bg-[#111520] border border-white/8 px-3 py-2">
            <div className="font-semibold text-white truncate">{user.full_name}</div>
            <div className="text-[11px] text-slate-400">
              {user.role} · {user.experience_level}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-xs text-slate-300 hover:bg-white/5 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Persistent Top Header + Environment Switcher */}
        <header className="sticky top-0 z-30 border-b border-white/8 bg-[#090B10]/95 backdrop-blur-md">
          <div className="px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="lg:hidden font-display text-sm font-bold text-white truncate">{brandingName}</span>
              <span className="hidden lg:inline text-xs font-medium text-slate-400 truncate">
                {sidebarItems.find((i) => i.id === activeTab)?.label || 'Panel'}
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Mandatory Permanent DEMO / REAL Selector */}
              <div className="flex items-center p-0.5 rounded-lg bg-[#111520] border border-white/15">
                <button
                  type="button"
                  onClick={() => setEnv('DEMO')}
                  className={`px-2.5 sm:px-3 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    env === 'DEMO' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  DEMO
                </button>
                <button
                  type="button"
                  onClick={() => setEnv('REAL')}
                  className={`px-2.5 sm:px-3 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    env === 'REAL' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  REAL
                </button>
              </div>

              {env === 'DEMO' && (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  title="Restablecer saldo virtual DEMO"
                  className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Restablecer DEMO</span>
                </button>
              )}

              {/* Notifications Trigger */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="relative flex items-center justify-center h-9 w-9 rounded-lg border border-white/10 bg-[#111520] text-slate-300 hover:text-white cursor-pointer"
                  aria-label="Notificaciones"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-blue-600 text-[10px] font-bold text-white flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-white/15 bg-[#111520] shadow-2xl z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8 text-xs">
                      <span className="font-semibold text-white">Notificaciones</span>
                      <button type="button" onClick={handleMarkNotificationsRead} className="text-blue-400 hover:underline cursor-pointer">
                        Marcar leídas
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-white/6">
                      {safeNotifications.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">Sin notificaciones recientes.</div>
                      ) : (
                        safeNotifications.slice(0, 12).map((n) => (
                          <div key={n.id} className={`p-3 text-xs ${n.read === 0 ? 'bg-blue-500/8' : ''}`}>
                            <div className="font-semibold text-white">{n.title}</div>
                            <div className="text-slate-400 mt-0.5">{n.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleNavigate('profile')}
                className="hidden sm:flex items-center gap-2 rounded-lg border border-white/10 bg-[#111520] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 cursor-pointer"
              >
                <span className="h-5 w-5 rounded-full bg-blue-600 text-[10px] font-bold flex items-center justify-center text-white">
                  {user.full_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[100px] truncate">{user.full_name.split(' ')[0]}</span>
              </button>
            </div>
          </div>

          {/* Permanent Active Environment Strip */}
          <div
            className={`px-4 py-1 text-center text-[11px] font-semibold tracking-wide border-t ${
              env === 'DEMO'
                ? 'bg-amber-500/12 border-amber-500/25 text-amber-300'
                : 'bg-emerald-500/12 border-emerald-500/25 text-emerald-300'
            }`}
          >
            {env === 'DEMO'
              ? '<DEMO ACTIVO — DINERO VIRTUAL> · Las operaciones, órdenes y saldos están aislados y no tienen valor real.'
              : '<MODO REAL ACTIVO> · Entorno separado estrictamente del saldo DEMO. Retiros requieren KYC y 2FA.'}
          </div>
        </header>

        {/* Workspace Viewport */}
        <main className="flex-1 p-3 sm:p-6 pb-24 lg:pb-8 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              env={env}
              experience={user.experience_level}
              markets={markets}
              favorites={Array.isArray(user.favorites) ? user.favorites : []}
              wallets={wallets}
              walletSummary={walletSummary}
              orders={orders}
              positions={positions}
              bots={bots}
              signals={signals}
              onNavigate={handleNavigate}
              onToggleFavorite={handleToggleFavorite}
              onResetDemo={handleResetDemo}
            />
          )}

          {activeTab === 'markets' && (
            <MarketsView
              markets={markets}
              favorites={Array.isArray(user.favorites) ? user.favorites : []}
              onToggleFavorite={handleToggleFavorite}
              onSelectTrade={(t, sym) => handleNavigate(t, sym)}
            />
          )}

          {activeTab === 'spot' && (
            <SpotExchangeView
              env={env}
              experience={user.experience_level}
              markets={markets}
              selectedSymbol={selectedSymbol}
              presetSide={presetSpotSide}
              wallets={wallets}
              orders={orders}
              onChangeSymbol={setSelectedSymbol}
              onOrderCompleted={() => loadUserEnvData(env)}
            />
          )}

          {activeTab === 'futures' && (
            <FuturesView
              env={env}
              markets={markets}
              selectedSymbol={selectedSymbol}
              wallets={wallets}
              positions={positions}
              onChangeSymbol={setSelectedSymbol}
              onUpdated={() => loadUserEnvData(env)}
            />
          )}

          {activeTab === 'quick-trade' && (
            <QuickTradingView
              env={env}
              markets={markets}
              selectedSymbol={selectedSymbol}
              wallets={wallets}
              onChangeSymbol={setSelectedSymbol}
              onSettled={() => loadUserEnvData(env)}
            />
          )}

          {activeTab === 'bots' && (
            <BotsView
              env={env}
              markets={markets}
              bots={bots}
              templates={botTemplates}
              onRefresh={() => loadUserEnvData(env)}
            />
          )}

          {(activeTab === 'signals' || activeTab === 'market-intel') && (
            <SignalsAndIntelView
              mode={activeTab}
              markets={markets}
              signals={signals}
              onRefreshSignals={loadPublicData}
              onApplyTrade={(t, sym) => handleNavigate(t, sym)}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletView
              env={env}
              wallets={wallets}
              summary={walletSummary}
              transactions={walletTxs}
              whitelist={whitelist}
              onRefresh={() => loadUserEnvData(env)}
            />
          )}

          {(activeTab === 'token-factory' || activeTab === 'launchpad') && (
            <TokenFactoryView
              mode={activeTab}
              userRole={user.role}
              tokens={tokens}
              markets={markets}
              onRefresh={loadPublicData}
              onTradeToken={(t, sym) => handleNavigate(t, sym)}
            />
          )}

          {(activeTab === 'community' || activeTab === 'referrals' || activeTab === 'competitions' || activeTab === 'academy') && (
            <CommunityAndGrowthView mode={activeTab} user={user} wsLatestChat={wsLatestChat} />
          )}

          {activeTab === 'profile' && <ProfileSecurityView user={user} onUserUpdated={setUser} />}

          {activeTab === 'superadmin' && (
            <SuperadminView
              userRole={user.role}
              onNavigateTokenFactory={(t) => handleNavigate(t)}
              onBootstrapRefresh={loadPublicData}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Thumb Bar (5 Primary Tabs + More Drawer) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0C0F17]/95 backdrop-blur-md border-t border-white/10 pb-safe">
        <div className="grid grid-cols-6 h-15 items-center">
          {[
            { id: 'dashboard' as NavSection, label: 'Inicio', icon: LayoutDashboard },
            { id: 'markets' as NavSection, label: 'Mercados', icon: LineChart },
            { id: 'spot' as NavSection, label: 'Trade', icon: CandleIcon },
            { id: 'bots' as NavSection, label: 'Bots', icon: Bot },
            { id: 'wallet' as NavSection, label: 'Wallet', icon: Wallet },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleNavigate(tab.id)}
                className={`flex flex-col items-center justify-center min-h-[44px] cursor-pointer ${
                  active ? 'text-blue-400' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium mt-0.5">{tab.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreSheetOpen(true)}
            className="flex flex-col items-center justify-center min-h-[44px] text-slate-400 cursor-pointer"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium mt-0.5">MÁS</span>
          </button>
        </div>
      </nav>

      {/* Mobile "MÁS" Slide-Up Sheet */}
      {moreSheetOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end">
          <div className="w-full rounded-t-3xl border-t border-white/15 bg-[#111520] p-5 space-y-4 max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="font-display text-base font-bold text-white">Todas las Herramientas</span>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                className="h-9 w-9 rounded-full bg-white/8 flex items-center justify-center text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center min-h-[72px] cursor-pointer ${
                      activeTab === item.id
                        ? 'border-blue-500 bg-blue-600/20 text-white'
                        : 'border-white/8 bg-[#090B10] text-slate-300'
                    }`}
                  >
                    <Icon className="h-5 w-5 text-blue-400" />
                    <span className="text-[11px] font-medium leading-tight">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-xs font-semibold text-red-300"
            >
              <LogOut className="h-4 w-4" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
