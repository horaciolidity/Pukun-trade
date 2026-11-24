import { useState } from 'react';
import { ShieldCheck, ArrowRight, Bot, Cpu, Layers, TrendingUp, Lock, KeyRound } from 'lucide-react';
import { apiFetch, formatPrice, setStoredToken } from '../api';
import { Market, UserProfile } from '../types';
import { isSupabaseConfigured, signUpWithSupabase, signInWithSupabase, supabase } from '../supabase';

interface Props {
  markets: Market[];
  onAuthenticated: (user: UserProfile) => void;
}

export function LandingAuth({ markets, onAuthenticated }: Props) {
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');
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

  async function handleQuickDemoLogin(presetEmail: string, presetPass: string) {
    setError('');
    setLoading(true);
    try {
      if (isSupabaseConfigured()) {
        try {
          const res = await signInWithSupabase(presetEmail, presetPass);
          setStoredToken(res.sessionToken);
          onAuthenticated(res.user);
          return;
        } catch {
          // If demo user is not yet created in Supabase, fall through to instant demo profile
        }
      }
      const demoUser: UserProfile = {
        id: 'usr_demo_trader',
        email: presetEmail,
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
      };
      setStoredToken('demo_token_trader');
      onAuthenticated(demoUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión DEMO');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones */}
      <header className="border-b border-white/8 bg-[#090B10]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 py-4">
          <a href="#top" className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            CRYPTO AI EXCHANGE
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a href="#mercados" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Mercados
            </a>
            <a href="#modulos" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Ecosistema
            </a>
            <a href="#seguridad" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Entorno DEMO
            </a>
            <a href="#acceso" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Acceso
            </a>
          </nav>

          <button
            type="button"
            onClick={() => handleQuickDemoLogin('trader@cryptoai.demo', 'DemoTrader2026!')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Entrar en DEMO
          </button>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Split */}
        <section className="mx-auto max-w-7xl px-4 sm:px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-7 space-y-6">
            <p className="text-xs font-medium tracking-wide text-blue-400">
              Spot · Futuros hasta 125x · Bots Algorítmicos · IA Cuantitativa · Token Factory
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1] max-w-2xl text-balance">
              Opera con precisión institucional desde tu primer día en modo DEMO.
            </h1>
            <p className="text-base text-slate-400 max-w-xl leading-relaxed">
              Combina gráficos financieros profesionales, ejecución automática con 7 estrategias de bots, inteligencia de
              mercado multi-proveedor con Gemini y creación de activos propios en un entorno seguro que separa
              estrictamente el dinero virtual del real.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleQuickDemoLogin('trader@cryptoai.demo', 'DemoTrader2026!')}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors cursor-pointer"
              >
                <span>Iniciar con 10.000 USDT DEMO</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemoLogin('superadmin@cryptoai.demo', 'SuperAdmin2026!')}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#121622] px-5 py-3 text-sm font-medium text-slate-200 hover:bg-[#192030] transition-colors cursor-pointer"
              >
                <KeyRound className="h-4 w-4 text-violet-400" />
                <span>Acceso Superadmin</span>
              </button>
            </div>

            {/* Live Market Strip */}
            <div id="mercados" className="pt-6">
              <div className="rounded-xl border border-white/10 bg-[#10141F] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 text-xs text-slate-400">
                  <span className="font-medium text-slate-200">Cotizaciones en Vivo</span>
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
                        <span className={`w-16 text-right text-xs font-semibold ${m.change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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

          {/* Auth Card */}
          <div id="acceso" className="lg:col-span-5">
            <div className="rounded-xl border border-white/10 bg-[#111520] p-6 sm:p-7">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090B10] border border-white/8 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setError('');
                    setNeeds2FA(false);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    authMode === 'login' ? 'bg-[#1A2133] text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Iniciar Sesión
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setError('');
                    setNeeds2FA(false);
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    authMode === 'register' ? 'bg-[#1A2133] text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Crear Cuenta
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
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {authMode !== 'forgot' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Contraseña</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                )}

                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Código de referido (opcional)</label>
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                      placeholder="CRYPTOAI-ALEX"
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                )}

                {needs2FA && (
                  <div>
                    <label className="block text-xs font-medium text-blue-300 mb-1.5">
                      Código 2FA {hint2FA ? `(Código temporal de prueba: ${hint2FA})` : ''}
                    </label>
                    <input
                      type="text"
                      required
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value)}
                      placeholder="6 dígitos"
                      className="w-full rounded-lg border border-blue-500/40 bg-[#090B10] px-3.5 py-2.5 text-sm font-mono text-white focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                )}

                {error && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
                    {error}
                  </div>
                )}
                {infoMsg && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2.5 text-xs text-blue-300">
                    {infoMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading
                    ? 'Procesando...'
                    : authMode === 'login'
                    ? 'Acceder al Exchange'
                    : authMode === 'register'
                    ? 'Registrar cuenta con 10.000 USDT DEMO'
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
                  <Lock className="h-3.5 w-3.5" />
                  <span>JWT + Bcrypt + 2FA</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture Pillars */}
        <section id="modulos" className="border-t border-white/8 bg-[#0C0F17] py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="rounded-xl border border-white/8 bg-[#111520] p-5 space-y-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              <h2 className="font-display text-base font-semibold text-white">Spot, Futuros 125x & Quick Trade</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Gráficos TradingView con indicadores técnicos, libro de órdenes, cálculo automático de liquidación y
                contratos rápidos de 15s a 5m.
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-[#111520] p-5 space-y-2">
              <Bot className="h-5 w-5 text-blue-400" />
              <h2 className="font-display text-base font-semibold text-white">7 Bots de Trading Algorítmico</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Scalping, Trend Following, Grid, DCA, Arbitrage, AI Predictive y Smart Futures con métricas separadas de
                backtest y simulación DEMO.
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-[#111520] p-5 space-y-2">
              <Cpu className="h-5 w-5 text-violet-400" />
              <h2 className="font-display text-base font-semibold text-white">Market Intelligence AI</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Motor multi-proveedor impulsado por Gemini en servidor. Probabilidades normalizadas al 100%, riesgos y
                lectura objetiva de indicadores.
              </p>
            </div>
            <div id="seguridad" className="rounded-xl border border-white/8 bg-[#111520] p-5 space-y-2">
              <Layers className="h-5 w-5 text-amber-400" />
              <h2 className="font-display text-base font-semibold text-white">Token Factory & Separación DEMO/REAL</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Asistente de creación de tokens ERC-20/SPL, Launchpad y separación contable estricta entre fondos
                virtuales y reales.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/8 py-5 px-4 sm:px-6 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>CRYPTO AI EXCHANGE · Arquitectura modular educativa y operativa</span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Todos los usuarios nuevos comienzan en MODO DEMO con capital virtual</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
