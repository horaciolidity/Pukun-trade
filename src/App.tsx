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
  Share2,
  Check,
  Copy,
  Download,
  Crown,
} from 'lucide-react';
import { apiFetch, getStoredToken, setStoredToken } from './api';
import {
  AdminFutureEvent,
  AdminPromoBanner,
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
import { TradeResultFx } from './components/TradeResultFx';
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
  const [brandingName, setBrandingName] = useState('PUKUN TRADE');
  const [promoBanners, setPromoBanners] = useState<AdminPromoBanner[]>([]);
  const [futureEvents, setFutureEvents] = useState<AdminFutureEvent[]>([]);
  const [referralRewardUsdt, setReferralRewardUsdt] = useState(40);

  const [notifOpen, setNotifOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [launchingCard, setLaunchingCard] = useState<{ id: NavSection; label: string } | null>(null);
  const [refCopied, setRefCopied] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [wsLatestChat, setWsLatestChat] = useState<ChatMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Capture Android / Chrome PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const loadPublicData = useCallback(async () => {
    try {
      const [mktRes, bootRes, sigRes, tokRes] = await Promise.all([
        apiFetch<{ markets: Market[] }>('/api/markets').catch(() => null),
        apiFetch<{
          branding: { name?: string };
          modules: Record<string, boolean>;
          promoBanners?: AdminPromoBanner[];
          futureEvents?: AdminFutureEvent[];
          referralSettings?: { inviteRewardUsdt?: number };
        }>('/api/bootstrap').catch(() => null),
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
      if (Array.isArray(bootRes?.promoBanners)) setPromoBanners(bootRes.promoBanners);
      if (Array.isArray(bootRes?.futureEvents)) setFutureEvents(bootRes.futureEvents);
      if (bootRes?.referralSettings?.inviteRewardUsdt) {
        setReferralRewardUsdt(bootRes.referralSettings.inviteRewardUsdt);
      }
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
          { asset: 'USDT', available: 10000, locked: 0, usdPrice: 1, usdValue: 10000, addresses: {} },
          { asset: 'BTC', available: 0.25, locked: 0, usdPrice: 91450, usdValue: 22862.5, addresses: {} },
          { asset: 'ETH', available: 2.5, locked: 0, usdPrice: 3240, usdValue: 8100, addresses: {} },
          { asset: 'SOL', available: 15, locked: 0, usdPrice: 214, usdValue: 3210, addresses: {} },
          { asset: 'CAIX', available: 500, locked: 0, usdPrice: 1.45, usdValue: 725, addresses: {} },
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
          setStoredToken('');
        }
      }
      setBooting(false);
    }
    init();

    // Listen to Supabase auth events (e.g. returning from email confirmation link)
    if (isSupabaseConfigured()) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
          const sbUser = await getCurrentSupabaseUser();
          if (sbUser) {
            setStoredToken(session.access_token);
            setUser(sbUser);
          }
        } else if (event === 'SIGNED_OUT') {
          setStoredToken('');
          setUser(null);
        }
      });
      return () => subscription.unsubscribe();
    }
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
    setLaunchingCard(null);
  }

  function handleImmersiveCardClick(tab: NavSection, label: string) {
    if (launchingCard) return;
    setLaunchingCard({ id: tab, label });
    setTimeout(() => {
      handleNavigate(tab);
    }, 420);
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

  async function handleCopyShareReferral() {
    if (!user) return;
    const code = user.referral_code || `PUKUN-${user.id.slice(0, 6).toUpperCase()}`;
    const shareUrl = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
    const shareText = `¡Gana 40 USDT en Pukun Trade! Regístrate con mi código ${code} y opera con 10.000 USDT DEMO: ${shareUrl}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2400);
      if (typeof navigator !== 'undefined' && 'share' in navigator && window.innerWidth < 768) {
        await navigator.share({ title: 'Pukun Trade — Invitación', text: shareText, url: shareUrl }).catch(() => {});
      }
    } catch {
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2400);
    }
  }

  async function handleInstallPwa() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    setDeferredInstallPrompt(null);
  }

  function handleLogout() {
    if (isSupabaseConfigured()) {
      supabase.auth.signOut().catch(() => {});
    }
    setStoredToken('');
    setUser(null);
    setActiveTab('dashboard');
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-[#090B10] flex flex-col items-center justify-center gap-3 text-xs text-slate-400">
        <img src="/logo.png" alt="Pukun Trade" className="h-12 w-12 rounded-2xl border border-amber-400/35 animate-pulse" />
        <span>Inicializando PUKUN TRADE...</span>
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
    <div className="min-h-screen pukun-bg-pattern text-slate-100 flex">
      <TradeResultFx />
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-60 xl:w-64 flex-col border-r border-amber-500/15 bg-[#0C0F17] sticky top-0 h-screen shrink-0">
        <div className="px-4 py-3.5 border-b border-white/8 flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Pukun Trade"
            className="h-9 w-9 rounded-xl border border-amber-400/35 shadow-md shadow-amber-500/10 object-cover shrink-0"
          />
          <div className="min-w-0 leading-tight">
            <div className="font-display text-sm font-bold tracking-tight text-white truncate">
              {brandingName === 'CRYPTO AI EXCHANGE' ? 'PUKUN TRADE' : brandingName}
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-cyan-400/90 font-semibold">
              Ancestral Tech
            </div>
          </div>
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
                  active
                    ? 'bg-linear-to-r from-amber-500/20 to-cyan-500/15 text-amber-200 border border-amber-400/30'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-amber-400' : ''}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/8 text-xs space-y-2">
          {deferredInstallPrompt && (
            <button
              type="button"
              onClick={handleInstallPwa}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-cyan-500/35 bg-cyan-500/10 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Instalar App</span>
            </button>
          )}
          <div className="rounded-lg bg-[#111520] border border-white/8 px-3 py-2">
            <div className="font-semibold text-white truncate flex items-center gap-1.5">
              <span className="truncate">{user.full_name}</span>
              {user.role === 'SUPERADMIN' && <Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
            </div>
            <div className="text-[10px] text-slate-400">
              <span className={user.role === 'SUPERADMIN' ? 'text-amber-400 font-semibold' : ''}>{user.role}</span> · {user.experience_level}
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
        <header className="sticky top-0 z-30 border-b border-amber-500/15 bg-[#090B10]/95 backdrop-blur-md">
          <div className="px-2.5 sm:px-6 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/logo.png"
                alt="Pukun Trade"
                className="lg:hidden h-7 w-7 rounded-lg border border-amber-400/35 object-cover shrink-0"
              />
              <span className="lg:hidden font-display text-xs sm:text-sm font-bold text-white truncate">
                PUKUN <span className="text-amber-400">TRADE</span>
              </span>
              <span className="hidden lg:inline text-xs font-medium text-slate-400 truncate">
                {sidebarItems.find((i) => i.id === activeTab)?.label || 'Panel'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              {/* Mandatory Permanent DEMO / REAL Selector */}
              <div className="flex items-center p-0.5 rounded-lg bg-[#111520] border border-white/15">
                <button
                  type="button"
                  onClick={() => setEnv('DEMO')}
                  className={`px-2 sm:px-3 py-1 rounded-md text-[10px] sm:text-[11px] font-bold transition-colors cursor-pointer ${
                    env === 'DEMO' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  DEMO
                </button>
                <button
                  type="button"
                  onClick={() => setEnv('REAL')}
                  className={`px-2 sm:px-3 py-1 rounded-md text-[10px] sm:text-[11px] font-bold transition-colors cursor-pointer ${
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
                  className="hidden xl:inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 cursor-pointer"
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
                  className="relative flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-lg border border-white/10 bg-[#111520] text-slate-300 hover:text-white cursor-pointer"
                  aria-label="Notificaciones"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-blue-600 text-[10px] font-bold text-white flex items-center justify-center">
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

              {/* Always-Visible User Name + Referral Copy/Share Icon with tiny earn hint */}
              <div className="flex items-center gap-1 rounded-xl border border-amber-500/25 bg-[#111520] px-2 py-1">
                <button
                  type="button"
                  onClick={() => handleNavigate('profile')}
                  className="flex items-center gap-1.5 text-xs text-slate-100 hover:text-amber-300 transition-colors cursor-pointer"
                  title={`${user.full_name} (${user.role})`}
                >
                  <span className="h-6 w-6 rounded-full bg-linear-to-br from-amber-500 to-cyan-500 text-[10px] font-bold flex items-center justify-center text-slate-950 shrink-0">
                    {user.full_name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex flex-col items-start leading-none">
                    <span className="max-w-20 sm:max-w-28 truncate text-[11px] font-semibold text-white flex items-center gap-1">
                      <span className="truncate">{user.full_name.split(' ')[0]}</span>
                      {user.role === 'SUPERADMIN' && <Crown className="h-2.5 w-2.5 text-amber-400 shrink-0" />}
                    </span>
                    <span className="text-[8.5px] sm:text-[9px] text-amber-400/95 font-medium tracking-tight mt-0.5 whitespace-nowrap">
                      {refCopied ? '¡Enlace copiado!' : `Gana ${referralRewardUsdt} USDT compartiendo`}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleCopyShareReferral}
                  title={`Copiar y compartir tu referido (${user.referral_code}) para ganar dinero`}
                  aria-label="Copiar enlace de referido"
                  className={`ml-0.5 flex items-center justify-center h-7 w-7 rounded-lg border transition-all cursor-pointer shrink-0 ${
                    refCopied
                      ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                      : 'border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  }`}
                >
                  {refCopied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Permanent Active Environment Strip */}
          <div className="pukun-step-accent w-full opacity-75" />
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
        <main className="flex-1 p-3 sm:p-6 pb-24 lg:pb-8 max-w-360 w-full mx-auto">
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
              promoBanners={promoBanners}
              futureEvents={futureEvents}
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
              referralCode={user.referral_code}
              referralRewardUsdt={referralRewardUsdt}
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
                className={`flex flex-col items-center justify-center min-h-11 cursor-pointer ${
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
            className="flex flex-col items-center justify-center min-h-11 text-slate-400 cursor-pointer"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium mt-0.5">MÁS</span>
          </button>
        </div>
      </nav>

      {/* Mobile "MÁS" Slide-Up Sheet — Patagonian Sunset Horizon & Visual Image Cards */}
      {moreSheetOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end"
          onClick={() => setMoreSheetOpen(false)}
        >
          <div
            className="relative w-full rounded-t-3xl border-t border-amber-400/40 bg-[#090B10] overflow-hidden max-h-[88vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full Patagonian Dark Sunset Horizon Background */}
            <div
              className="absolute inset-0 bg-cover bg-bottom opacity-65 pointer-events-none"
              style={{ backgroundImage: "url('/patagonia-sunset-bg.jpg')" }}
            />
            <div className="absolute inset-0 bg-linear-to-b from-[#090B10]/85 via-[#090B10]/65 to-[#090B10]/92 pointer-events-none" />

            {/* Top Drag Handle + Branded Header */}
            <div className="relative px-5 pt-3 pb-3.5 border-b border-amber-400/20 shrink-0">
              <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-amber-300/40" />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src="/logo.png"
                    alt="Pukun Trade"
                    className="h-10 w-10 rounded-xl border border-amber-400/50 shadow-lg shadow-amber-500/20 object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-display text-sm font-bold text-white flex items-center gap-1.5">
                      <span>PUKUN <span className="text-amber-400">TRADE</span></span>
                      {user.role === 'SUPERADMIN' && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/25 border border-amber-400/50 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">
                          <Crown className="h-2.5 w-2.5" />
                          SUPERADMIN
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-amber-100/80 truncate">{user.full_name} · {user.email}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreSheetOpen(false)}
                  className="h-9 w-9 rounded-full bg-black/50 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shrink-0 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="pukun-step-accent w-full mt-3 opacity-80" />
            </div>

            {/* Scrollable Visual Image Cards */}
            <div className="relative p-4 space-y-4 overflow-y-auto flex-1">
              {/* Referral Quick-Earn Card over Patagonian Sunset */}
              <div className="relative rounded-2xl border border-amber-400/45 overflow-hidden shadow-xl">
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-45 pointer-events-none"
                  style={{ backgroundImage: "url('/og-ref-40usdt.jpg')" }}
                />
                <div className="absolute inset-0 bg-linear-to-r from-[#090B10]/95 via-[#090B10]/80 to-[#090B10]/55 pointer-events-none" />
                <div className="relative p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                      <Gift className="h-3.5 w-3.5 shrink-0" />
                      <span>Invita y Gana {referralRewardUsdt} USDT</span>
                    </div>
                    <div className="text-[10px] text-slate-200 mt-0.5 truncate">
                      Código: <span className="font-mono font-bold text-white">{user.referral_code}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyShareReferral}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-linear-to-r from-amber-500 to-amber-400 px-3 py-2 text-[11px] font-bold text-slate-950 shrink-0 cursor-pointer shadow-lg shadow-amber-500/25"
                  >
                    {refCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{refCopied ? 'Copiado' : 'Compartir'}</span>
                  </button>
                </div>
              </div>

              {/* Categorized Visual Cards Grid — Unique Artwork per Component + Immersive Launch */}
              {(() => {
                const cardMeta: Record<NavSection, { img: string; desc: string }> = {
                  dashboard: { img: '/cards/card-dashboard.svg', desc: 'Resumen & Portfolio' },
                  markets: { img: '/cards/card-markets.svg', desc: 'Cotizaciones en vivo' },
                  spot: { img: '/cards/card-spot.svg', desc: 'Compra & Venta directa' },
                  futures: { img: '/cards/card-futures.svg', desc: 'Perpetuos hasta 125x' },
                  'quick-trade': { img: '/cards/card-quick-trade.svg', desc: 'Rondas rápidas 15s–5m' },
                  bots: { img: '/cards/card-bots.svg', desc: '7 Estrategias automáticas' },
                  signals: { img: '/cards/card-signals.svg', desc: 'Alertas en tiempo real' },
                  'market-intel': { img: '/cards/card-market-intel.svg', desc: 'IA Cuantitativa Gemini' },
                  wallet: { img: '/cards/card-wallet.svg', desc: 'Bóveda 9 Blockchains' },
                  launchpad: { img: '/cards/card-launchpad.svg', desc: 'Lanzamientos & Pools' },
                  'token-factory': { img: '/cards/card-token-factory.svg', desc: 'Crear tokens & horarios' },
                  referrals: { img: '/cards/card-referrals.svg', desc: `Gana ${referralRewardUsdt} USDT invitando` },
                  competitions: { img: '/cards/card-competitions.svg', desc: 'Rankings & Torneos' },
                  community: { img: '/cards/card-community.svg', desc: 'Chat en vivo 7 salas' },
                  academy: { img: '/cards/card-academy.svg', desc: 'Guías & Tutoriales' },
                  profile: { img: '/cards/card-profile.svg', desc: 'Seguridad 2FA & KYC' },
                  superadmin: { img: '/cards/card-superadmin.svg', desc: 'Comisiones, Banners & Control' },
                };

                return [
                  {
                    title: 'Trading & Mercados',
                    ids: ['dashboard', 'markets', 'spot', 'futures', 'quick-trade'] as NavSection[],
                  },
                  {
                    title: 'Inteligencia Artificial',
                    ids: ['bots', 'signals', 'market-intel'] as NavSection[],
                  },
                  {
                    title: 'Activos, Web3 & Crecimiento',
                    ids: ['wallet', 'launchpad', 'token-factory', 'referrals', 'competitions'] as NavSection[],
                  },
                  {
                    title: 'Comunidad & Cuenta',
                    ids: ['community', 'academy', 'profile', 'superadmin'] as NavSection[],
                  },
                ].map((group) => {
                  const items = sidebarItems.filter((item) => group.ids.includes(item.id));
                  if (items.length === 0) return null;
                  return (
                    <div key={group.title} className="space-y-2">
                      <div className="flex items-center gap-2 px-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200/90 drop-shadow">
                          {group.title}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {items.map((item) => {
                          const Icon = item.icon;
                          const active = activeTab === item.id;
                          const isLaunching = launchingCard?.id === item.id;
                          const isDimmed = Boolean(launchingCard && !isLaunching);
                          const meta = cardMeta[item.id] || { img: '/cards/card-dashboard.svg', desc: 'Explorar módulo' };
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleImmersiveCardClick(item.id, item.label)}
                              className={`group relative rounded-2xl border overflow-hidden text-left h-24 p-3 flex flex-col justify-between transition-all duration-300 cursor-pointer shadow-lg ${
                                isLaunching
                                  ? 'z-30 border-amber-300 ring-2 ring-cyan-400 animate-pukun-card-portal'
                                  : isDimmed
                                    ? 'opacity-25 scale-95 border-white/5'
                                    : active
                                      ? 'border-amber-400 ring-1 ring-amber-400/50'
                                      : 'border-white/15 hover:border-amber-400/45 active:scale-95'
                              }`}
                            >
                              {/* Unique Module Artwork */}
                              <img
                                src={meta.img}
                                alt={item.label}
                                className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                              <div
                                className={`absolute inset-0 ${
                                  isLaunching
                                    ? 'bg-linear-to-t from-cyan-950/85 via-amber-500/20 to-transparent'
                                    : active
                                      ? 'bg-linear-to-t from-[#090B10]/95 via-[#090B10]/55 to-amber-500/15'
                                      : 'bg-linear-to-t from-[#090B10]/92 via-[#090B10]/55 to-transparent'
                                }`}
                              />

                              {/* Portal light sweep on click */}
                              {isLaunching && (
                                <span className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-amber-300/60 to-transparent animate-pukun-card-sweep pointer-events-none" />
                              )}

                              <div className="relative flex items-center justify-between gap-1">
                                <span
                                  className={`h-7 w-7 rounded-lg backdrop-blur-md border flex items-center justify-center transition-transform ${
                                    isLaunching
                                      ? 'scale-110 bg-amber-400 text-slate-950 border-amber-200'
                                      : active
                                        ? 'bg-amber-500/25 border-amber-400/60 text-amber-300'
                                        : 'bg-black/45 border-white/15 text-cyan-300'
                                  }`}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                {isLaunching ? (
                                  <span className="rounded-full bg-cyan-400 px-1.5 py-0.5 text-[8px] font-extrabold text-slate-950 uppercase animate-pulse">
                                    Entrando...
                                  </span>
                                ) : active ? (
                                  <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-extrabold text-slate-950 uppercase">
                                    Activo
                                  </span>
                                ) : null}
                              </div>

                              <div className="relative">
                                <div className="font-display text-xs font-bold text-white leading-tight drop-shadow">
                                  {item.label}
                                </div>
                                <div className="text-[9.5px] text-slate-200/90 leading-tight mt-0.5 truncate">
                                  {meta.desc}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Android PWA Install + Logout Actions */}
              <div className="pt-2 space-y-2 pb-2">
                {deferredInstallPrompt && (
                  <button
                    type="button"
                    onClick={handleInstallPwa}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-cyan-400/45 bg-cyan-500/20 backdrop-blur-md py-3 text-xs font-bold text-cyan-100 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>Instalar App Pukun Trade en Android</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-950/60 backdrop-blur-md py-3 text-xs font-semibold text-red-200 cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
