import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ArrowRight,
  Bot,
  Cpu,
  Layers,
  TrendingUp,
  Lock,
  Wallet,
  Sparkles,
  Rocket,
} from 'lucide-react';
import { apiFetch, formatPrice, setStoredToken } from '../api';
import { Market, UserProfile } from '../types';
import { isSupabaseConfigured, signUpWithSupabase, signInWithSupabase, supabase } from '../supabase';

interface Props {
  markets: Market[];
  onAuthenticated: (user: UserProfile) => void;
}

const MARKETING_BANNERS = [
  {
    id: 'trading',
    badge: 'TRADING PRO · 125X',
    title: 'Spot, Futuros 125x & Quick Trade',
    summary:
      'Gráficos TradingView en vivo con EMA, Bollinger, RSI y libro de órdenes. Opera Spot, contratos perpetuos hasta 125x o rondas rápidas de 15s a 5m.',
    image: '/banner-trading.jpg',
    icon: TrendingUp,
    accent: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/15',
    pills: ['Spot', 'Futuros 125x', 'Quick 15s-5m'],
  },
  {
    id: 'bots',
    badge: 'INTELIGENCIA ARTIFICIAL',
    title: '7 Bots Algorítmicos & Señales IA',
    summary:
      'Activa estrategias automáticas de Scalping, Grid, DCA, Arbitraje y AI Predictive con análisis cuantitativo impulsado por Gemini en tiempo real.',
    image: '/banner-bots.jpg',
    icon: Bot,
    accent: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/15',
    pills: ['7 Bots IA', 'Señales en Vivo', 'Market Intel'],
  },
  {
    id: 'wallet',
    badge: 'CUSTODIA & SEGURIDAD',
    title: 'Wallet Multi-Red & Entornos Separados',
    summary:
      'Gestiona tus activos en 9 blockchains (BTC, ETH, SOL, BNB, Polygon, Arbitrum, Tron y más) con separación estricta entre cuentas DEMO y REAL.',
    image: '/banner-wallet.jpg',
    icon: Wallet,
    accent: 'text-amber-400 border-amber-500/30 bg-amber-500/15',
    pills: ['9 Redes', 'DEMO 10K USDT', '2FA + KYC'],
  },
  {
    id: 'launchpad',
    badge: 'WEB3 & CREACIÓN',
    title: 'Token Factory, Launchpad & Referidos',
    summary:
      'Despliega tokens propios, participa en lanzamientos exclusivos, compite en rankings DEMO y gana comisiones en USDT compartiendo tu enlace.',
    image: '/banner-launchpad.jpg',
    icon: Rocket,
    accent: 'text-violet-400 border-violet-500/30 bg-violet-500/15',
    pills: ['Token Factory', 'Launchpad', 'Gana USDT'],
  },
];

export function LandingAuth({ markets, onAuthenticated }: Props) {
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [hint2FA, setHint2FA] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [sharedTradeBanner, setSharedTradeBanner] = useState<{ symbol: string; pnl: number; roi?: string } | null>(null);

  // Auto-detect ?ref=CODE (& optional shared trade PnL preview) in URL
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref && ref.trim()) {
        setReferralCode(ref.trim().toUpperCase());
        setAuthMode('register');
      }
      const sharedSym = params.get('trade');
      const sharedPnl = params.get('pnl');
      if (sharedSym && sharedPnl) {
        const pnlNum = Number(sharedPnl);
        if (Number.isFinite(pnlNum)) {
          setSharedTradeBanner({
            symbol: sharedSym,
            pnl: pnlNum,
            roi: params.get('roi') || undefined,
          });
        }
      }
    } catch {
      // ignore URL parsing errors
    }
  }, []);

  function focusAuth(mode: 'login' | 'register') {
    setAuthMode(mode);
    setError('');
    setInfoMsg('');
    const el = document.getElementById('acceso');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);
    try {
      if (authMode === 'forgot') {
        if (isSupabaseConfigured()) {
          const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email);
          if (resetErr) throw new Error(resetErr.message);
          setInfoMsg('Te hemos enviado un correo con instrucciones para restablecer tu contraseña.');
        } else {
          const res = await apiFetch<{ message: string }>('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email }),
          });
          setInfoMsg(res.message);
        }
      } else if (authMode === 'register') {
        if (isSupabaseConfigured()) {
          const { user, sessionToken } = await signUpWithSupabase(email, password, fullName, referralCode);
          setStoredToken(sessionToken);
          onAuthenticated(user);
        } else {
          const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password, fullName, referralCode }),
          });
          setStoredToken(res.token);
          onAuthenticated(res.user);
        }
      } else {
        if (isSupabaseConfigured()) {
          const { user, sessionToken } = await signInWithSupabase(email, password);
          setStoredToken(sessionToken);
          onAuthenticated(user);
        } else {
          const res = await apiFetch<{
            token?: string;
            user?: UserProfile;
            requires2FA?: boolean;
            tempHint?: string;
          }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password, twoFactorCode: needs2FA ? twoFactorCode : undefined }),
          });
          if (res.requires2FA) {
            setNeeds2FA(true);
            setHint2FA(res.tempHint || '');
            setInfoMsg('Ingresa el código 2FA de verificación para completar el acceso.');
          } else if (res.token && res.user) {
            setStoredToken(res.token);
            onAuthenticated(res.user);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-amber-500/15 bg-[#090B10]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 py-3.5">
          <a href="#top" className="flex items-center gap-3 whitespace-nowrap shrink-0 group">
            <img
              src="/logo.png"
              alt="Pukun Trade"
              className="h-9 w-9 rounded-xl border border-amber-400/35 shadow-lg shadow-amber-500/10 object-cover"
            />
            <div className="leading-tight">
              <div className="font-display text-base sm:text-lg font-bold tracking-tight text-white">
                PUKUN <span className="text-amber-400">TRADE</span>
              </div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-cyan-400/90 font-semibold">
                Ancestral Tech Exchange
              </div>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a href="#mercados" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Mercados
            </a>
            <a href="#modulos" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Ecosistema
            </a>
            <a href="#seguridad" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Seguridad
            </a>
            <a href="#acceso" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Acceso
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => focusAuth('login')}
              className="hidden sm:inline-flex rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => focusAuth('register')}
              className="rounded-lg bg-linear-to-r from-amber-500 to-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:brightness-110 transition-all whitespace-nowrap cursor-pointer shadow-lg shadow-amber-500/15"
            >
              Suscribirse Gratis
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Split with Ancestral-Tech Background */}
        <section className="relative overflow-hidden border-b border-white/8">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-35 pointer-events-none"
            style={{ backgroundImage: "url('/hero-bg.jpg')" }}
          />
          <div className="absolute inset-0 bg-linear-to-b from-[#090B10]/70 via-[#090B10]/80 to-[#090B10] pointer-events-none" />

          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold tracking-wide text-amber-300">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                <span>Precisión Ancestral de Tiwanaku · Inteligencia Artificial Cuantitativa</span>
              </div>

              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.08] max-w-2xl text-balance">
                El exchange cripto{' '}
                <span className="bg-linear-to-r from-amber-300 via-amber-400 to-cyan-400 bg-clip-text text-transparent">
                  ancestralmente tecnológico
                </span>{' '}
                diseñado para dominar el mercado.
              </h1>

              <p className="text-base text-slate-300 max-w-xl leading-relaxed">
                Opera Spot, Futuros hasta 125x, Quick Trading, 7 estrategias de Bots IA, Wallet Multi-Red y Token Factory.
                Regístrate ahora para recibir <strong className="text-amber-300">10.000 USDT virtuales</strong> en tu
                cuenta DEMO personal y comenzar a operar sin riesgo.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => focusAuth('register')}
                  className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-amber-500 to-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:brightness-110 transition-all cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  <span>Crear Cuenta Gratis</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#modulos"
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-[#121622]/90 px-5 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/10 transition-colors"
                >
                  <Cpu className="h-4 w-4 text-cyan-400" />
                  <span>Explorar Ecosistema</span>
                </a>
              </div>

              {/* Live Market Strip */}
              <div id="mercados" className="pt-4">
                <div className="rounded-xl border border-white/10 bg-[#10141F]/90 backdrop-blur-md overflow-hidden shadow-xl">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      Cotizaciones en Vivo (Binance Feed)
                    </span>
                    <span>Spot & Perpetuos</span>
                  </div>
                  <div className="divide-y divide-white/6">
                    {markets.slice(0, 5).map((m) => (
                      <div key={m.symbol} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-white">{m.base}</span>
                          <span className="text-xs text-slate-500">{m.symbol}</span>
                        </div>
                        <div className="flex items-center gap-6 tabular-nums font-mono">
                          <span className="text-slate-100">${formatPrice(m.last_price)}</span>
                          <span
                            className={`w-16 text-right text-xs font-semibold ${m.change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                          >
                            {m.change_24h >= 0 ? '+' : ''}
                            {m.change_24h.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Auth Card — Registro / Login Obligatorio */}
            <div id="acceso" className="lg:col-span-5">
              {sharedTradeBanner && (
                <div className="mb-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/12 p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      Operación Compartida por Invitación
                    </div>
                    <div className="text-xs text-white font-semibold mt-0.5">
                      {sharedTradeBanner.symbol}{' '}
                      <span className={sharedTradeBanner.pnl >= 0 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                        {sharedTradeBanner.pnl >= 0 ? '+' : '-'}${Math.abs(sharedTradeBanner.pnl).toFixed(2)} USDT
                        {sharedTradeBanner.roi ? ` (${sharedTradeBanner.roi}%)` : ''}
                      </span>
                    </div>
                  </div>
                  <span className="rounded-lg bg-amber-500/20 border border-amber-400/40 px-2.5 py-1 text-[10px] font-bold text-amber-300 shrink-0">
                    Bono 40 USDT
                  </span>
                </div>
              )}
              <div className="rounded-2xl border border-amber-500/20 bg-[#111520]/95 backdrop-blur-xl p-6 sm:p-7 shadow-2xl shadow-black/50">
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/8">
                  <img
                    src="/logo.png"
                    alt="Pukun Trade"
                    className="h-10 w-10 rounded-xl border border-amber-400/30 object-cover"
                  />
                  <div>
                    <h2 className="font-display text-base font-bold text-white">Acceso a Pukun Trade</h2>
                    <p className="text-[11px] text-slate-400">
                      Ingreso exclusivo para miembros registrados · Cuenta DEMO incluida
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090B10] border border-white/8 mb-5">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register');
                      setError('');
                      setNeeds2FA(false);
                    }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${authMode === 'register'
                      ? 'bg-linear-to-r from-amber-500/25 to-cyan-500/20 text-amber-200 border border-amber-400/30'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Crear Cuenta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setError('');
                      setNeeds2FA(false);
                    }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${authMode === 'login'
                      ? 'bg-[#1A2133] text-white border border-white/15'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Iniciar Sesión
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Nombre completo</label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Ej. Sofía Mendoza"
                        className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Correo electrónico</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="usuario@correo.com"
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  {authMode !== 'forgot' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Contraseña</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {authMode === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Código de referido (opcional)
                      </label>
                      <input
                        type="text"
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value)}
                        placeholder="PUKUN-XXXXXX"
                        className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {needs2FA && (
                    <div>
                      <label className="block text-xs font-medium text-cyan-300 mb-1.5">
                        Código 2FA {hint2FA ? `(Código temporal: ${hint2FA})` : ''}
                      </label>
                      <input
                        type="text"
                        required
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value)}
                        placeholder="6 dígitos"
                        className="w-full rounded-lg border border-cyan-500/40 bg-[#090B10] px-3.5 py-2.5 text-sm font-mono text-white focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
                      {error}
                    </div>
                  )}
                  {infoMsg && (
                    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2.5 text-xs text-cyan-200">
                      {infoMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-linear-to-r from-amber-500 to-cyan-500 py-2.5 text-sm font-bold text-slate-950 hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-amber-500/15"
                  >
                    {loading
                      ? 'Procesando...'
                      : authMode === 'login'
                        ? 'Acceder a Pukun Trade'
                        : authMode === 'register'
                          ? 'Suscribirme y Recibir 10.000 USDT DEMO'
                          : 'Enviar enlace de recuperación'}
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                  <button
                    type="button"
                    onClick={() => setAuthMode(authMode === 'forgot' ? 'login' : 'forgot')}
                    className="hover:text-white underline-offset-4 hover:underline cursor-pointer"
                  >
                    {authMode === 'forgot' ? 'Volver a iniciar sesión' : '¿Olvidaste tu contraseña?'}
                  </button>
                  <span className="flex items-center gap-1 text-slate-500">
                    <Lock className="h-3.5 w-3.5 text-amber-400/80" />
                    <span>Supabase Auth + 2FA</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Marketing Visual Banner Cards */}
        <section id="modulos" className="bg-[#0C0F17] py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
                  Ecosistema Integral Pukun Trade
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                  Todo lo que necesitas para operar y multiplicar tu capital en un solo lugar
                </h2>
              </div>
              <button
                type="button"
                onClick={() => focusAuth('register')}
                className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer shrink-0"
              >
                <span>Crea tu cuenta para probar cada módulo</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {MARKETING_BANNERS.map((banner) => {
                const Icon = banner.icon;
                return (
                  <div
                    key={banner.id}
                    className="group relative rounded-2xl border border-white/10 bg-[#111520] overflow-hidden hover:border-amber-400/40 transition-all shadow-xl flex flex-col"
                  >
                    {/* Banner Image Header */}
                    <div className="relative h-48 sm:h-52 overflow-hidden">
                      <img
                        src={banner.image}
                        alt={banner.title}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-linear-to-t from-[#111520] via-[#111520]/45 to-transparent" />
                      <div className="absolute top-3.5 left-3.5 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider backdrop-blur-md ${banner.accent}`}
                        >
                          <Icon className="h-3 w-3" />
                          {banner.badge}
                        </span>
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        <h3 className="font-display text-lg font-bold text-white group-hover:text-amber-300 transition-colors">
                          {banner.title}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{banner.summary}</p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/8">
                        <div className="flex flex-wrap gap-1.5">
                          {banner.pills.map((pill) => (
                            <span
                              key={pill}
                              className="rounded-md bg-white/5 border border-white/8 px-2 py-0.5 text-[10px] font-medium text-slate-300"
                            >
                              {pill}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => focusAuth('register')}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 cursor-pointer"
                        >
                          <span>Probar ahora</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Security & Separation Banner */}
            <div
              id="seguridad"
              className="rounded-2xl border border-amber-500/20 bg-linear-to-r from-[#111520] via-[#131929] to-[#111520] p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
                  <Layers className="h-5 w-5 text-amber-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-display text-base font-bold text-white">
                    Separación Contable Estricta DEMO / REAL + Programa de Referidos
                  </h3>
                  <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                    Al suscribirte obtienes acceso inmediato al entorno DEMO con 10.000 USDT virtuales aislados de tu
                    billetera real. Además, desde tu panel podrás copiar tu enlace personal de referido y ganar comisiones
                    en USDT invitando a otros traders.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => focusAuth('register')}
                className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-4 py-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                Registrarme Ahora
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/8 py-5 px-4 sm:px-6 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <img src="/logo.png" alt="Pukun Trade" className="h-5 w-5 rounded-md object-cover" />
            <span className="font-semibold text-slate-300">PUKUN TRADE</span>
            <span>· Tecnología Ancestral & Exchange Cripto IA</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Acceso exclusivo por suscripción · Entorno DEMO incluido</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
