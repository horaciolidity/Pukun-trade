import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Check, X, Download, RotateCcw } from 'lucide-react';
import { apiFetch, formatCurrency, formatPrice, getStoredToken } from '../api';
import { Market, NavSection, QuickTradeItem, UserRole } from '../types';
import {
  DEFAULT_THERMAL_COLORS,
  formatDurationLabel,
  mergeQuickTradeConfig,
  QuickTradeConfig,
} from '../utils/quickTradeMath';

interface Props {
  userRole: UserRole;
  onNavigateTokenFactory: (tab: NavSection) => void;
  onBootstrapRefresh: () => void;
}

interface AdminOverview {
  users: Array<{
    id: string;
    email: string;
    full_name: string;
    role: UserRole;
    experience_level: string;
    kyc_status: string;
    two_factor_enabled: number;
    status: string;
  }>;
  markets: Market[];
  providers: Array<{
    id: string;
    name: string;
    provider_type: string;
    model: string;
    priority: number;
    enabled: number;
    status: string;
    max_rpm: number;
  }>;
  transactions: Array<{
    id: string;
    user_id: string;
    env: string;
    type: string;
    asset: string;
    network: string;
    amount: number;
    txid: string;
    status: string;
  }>;
  auditLogs: Array<{
    id: string;
    admin_email: string;
    action: string;
    target: string;
    details: string;
    created_at: number;
  }>;
  reportedMsgs: Array<{ id: string; room: string; author_name: string; content: string }>;
  configs: {
    branding: { name: string; defaultCurrency: string; defaultLanguage: string; announcement: string };
    demo_settings: { initialCapital: number; feeBps: number; spreadBps: number; slippageBps: number; maxLeverage: number; allowTopup: boolean };
    quick_trading: QuickTradeConfig;
    referral_settings: { inviteRewardUsdt: number; firstDepositBonusPct: number; commissionPct: number; maxMonthlyRewardsUsdt: number };
    enabled_modules: Record<string, boolean>;
  };
  stats: {
    totalUsers: number;
    totalOrders: number;
    openFutures: number;
    activeBots: number;
    totalVolume24h: number;
  };
}

interface AdminQuickTradesData {
  trades: Array<QuickTradeItem & { user_id?: string; user_email?: string; user_name?: string }>;
  stats: {
    global: { total: number; active: number; wins: number; losses: number; draws: number; cancelled: number; winRatePct: number; totalVolume: number; traderNetPnl: number };
    demo: { total: number; active: number; wins: number; losses: number; draws: number; cancelled: number; winRatePct: number; totalVolume: number; traderNetPnl: number };
    real: { total: number; active: number; wins: number; losses: number; draws: number; cancelled: number; winRatePct: number; totalVolume: number; traderNetPnl: number };
  };
  auditLogs: Array<{ id: string; admin_email: string; action: string; target: string; details: string; created_at: number }>;
}

const ADMIN_TABS = [
  { id: 'stats', label: 'Estadísticas & Auditoría' },
  { id: 'users', label: 'Usuarios & Roles' },
  { id: 'finance', label: 'Finanzas & Wallet' },
  { id: 'exchange', label: 'Exchange & Futuros' },
  { id: 'ai', label: 'AI & Market Intel' },
  { id: 'demo', label: 'Modo DEMO' },
  { id: 'quick_trading', label: 'Quick Trading Pro' },
  { id: 'modules', label: 'Módulos & Marca' },
  { id: 'referrals', label: 'Referidos & Comunidad' },
];

export function SuperadminView({ userRole, onNavigateTokenFactory, onBootstrapRefresh }: Props) {
  const [tab, setTab] = useState('stats');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [qtDraft, setQtDraft] = useState<QuickTradeConfig | null>(null);
  const [qtEnvFilter, setQtEnvFilter] = useState<'ALL' | 'DEMO' | 'REAL'>('ALL');
  const [qtAdminData, setQtAdminData] = useState<AdminQuickTradesData | null>(null);
  const [newPair, setNewPair] = useState('');
  const [newPrice, setNewPrice] = useState('1.0');
  const [newLev, setNewLev] = useState('50');
  const [feedback, setFeedback] = useState('');

  async function loadOverview() {
    try {
      const res = await apiFetch<AdminOverview>('/api/superadmin/overview');
      setData(res);
      setQtDraft(mergeQuickTradeConfig(res.configs.quick_trading));
    } catch {
      // ignore
    }
  }

  async function loadQuickTradingAdmin(filterEnv: 'ALL' | 'DEMO' | 'REAL' = qtEnvFilter) {
    try {
      const res = await apiFetch<AdminQuickTradesData>(`/api/superadmin/quick-trades?env=${filterEnv}`);
      setQtAdminData(res);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadOverview();
    loadQuickTradingAdmin('ALL');
  }, []);

  if (!['ADMIN', 'SUPERADMIN'].includes(userRole)) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-xs text-red-300">
        Acceso denegado. El Panel Superadministrador requiere rol ADMIN o SUPERADMIN.
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-center text-xs text-slate-400">Cargando centro de control Superadmin...</div>;
  }

  async function updateUser(userId: string, patch: { role?: UserRole; status?: string; kycStatus?: string }) {
    await apiFetch(`/api/superadmin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setFeedback('Permisos/estado de usuario actualizado y registrado en auditoría.');
    loadOverview();
  }

  async function handleTxAction(txId: string, action: 'APPROVE' | 'REJECT') {
    await apiFetch(`/api/superadmin/transactions/${txId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
    setFeedback(`Transacción ${txId} marcada como ${action}.`);
    loadOverview();
  }

  async function handleAddMarket(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch('/api/superadmin/markets', {
      method: 'POST',
      body: JSON.stringify({ symbol: newPair, basePrice: Number(newPrice), maxLeverage: Number(newLev) }),
    });
    setNewPair('');
    setFeedback('Mercado agregado y activado en el exchange.');
    loadOverview();
  }

  async function toggleMarket(symbol: string, patch: Record<string, unknown>) {
    const [b, q] = symbol.split('/');
    await apiFetch(`/api/superadmin/markets/${b}/${q}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    loadOverview();
  }

  async function updateConfig(key: string, value: unknown) {
    await apiFetch(`/api/superadmin/config/${key}`, {
      method: 'PATCH',
      body: JSON.stringify(value),
    });
    setFeedback(`Configuración "${key}" guardada y auditada.`);
    loadOverview();
    onBootstrapRefresh();
  }

  async function toggleProvider(id: string, enabled: boolean) {
    await apiFetch(`/api/superadmin/ai-providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    loadOverview();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-400 text-xs font-semibold">
            <ShieldCheck className="h-4 w-4" />
            <span>CENTRO DE CONTROL INDEPENDIENTE Y AUDITADO</span>
          </div>
          <h1 className="font-display text-xl font-bold text-white">Panel Superadministrador</h1>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTokenFactory('token-factory')}
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 cursor-pointer"
        >
          Abrir Token Factory
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {ADMIN_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === t.id ? 'bg-violet-600 text-white' : 'bg-[#111520] border border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
          {feedback}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
              <div className="text-xs text-slate-400">Usuarios Totales</div>
              <div className="font-mono text-2xl font-bold text-white mt-1">{data.stats.totalUsers}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
              <div className="text-xs text-slate-400">Órdenes Ejecutadas</div>
              <div className="font-mono text-2xl font-bold text-blue-400 mt-1">{data.stats.totalOrders}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
              <div className="text-xs text-slate-400">Futuros Abiertos</div>
              <div className="font-mono text-2xl font-bold text-amber-400 mt-1">{data.stats.openFutures}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
              <div className="text-xs text-slate-400">Bots Activos</div>
              <div className="font-mono text-2xl font-bold text-emerald-400 mt-1">{data.stats.activeBots}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
              <div className="text-xs text-slate-400">Volumen 24h Global</div>
              <div className="font-mono text-xl font-bold text-white mt-1">${formatCurrency(data.stats.totalVolume24h / 1000000, 1)}M</div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
            <div className="px-4 py-3 border-b border-white/8 text-sm font-semibold text-white">
              Registro de Auditoría Inmutable
            </div>
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-white/8 text-[11px] text-slate-400">
                  <th className="py-2.5 px-4">Fecha</th>
                  <th className="py-2.5 px-4">Administrador</th>
                  <th className="py-2.5 px-4">Acción</th>
                  <th className="py-2.5 px-4">Objetivo</th>
                  <th className="py-2.5 px-4">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {data.auditLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 px-4 font-mono text-slate-400">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="py-2 px-4 text-white">{a.admin_email}</td>
                    <td className="py-2 px-4 font-semibold text-violet-300">{a.action}</td>
                    <td className="py-2 px-4 font-mono text-slate-300">{a.target}</td>
                    <td className="py-2 px-4 text-slate-400 truncate max-w-xs">{a.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">Rol RBAC</th>
                <th className="py-3 px-4">KYC</th>
                <th className="py-3 px-4">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white">{u.full_name}</div>
                    <div className="text-slate-500">{u.email}</div>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value as UserRole })}
                      className="rounded border border-white/10 bg-[#090B10] px-2 py-1 text-xs text-white"
                    >
                      {['USER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'SUPERADMIN'].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.kyc_status}
                      onChange={(e) => updateUser(u.id, { kycStatus: e.target.value })}
                      className="rounded border border-white/10 bg-[#090B10] px-2 py-1 text-xs text-white"
                    >
                      {['UNVERIFIED', 'PENDING', 'VERIFIED'].map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.status}
                      onChange={(e) => updateUser(u.id, { status: e.target.value })}
                      className="rounded border border-white/10 bg-[#090B10] px-2 py-1 text-xs text-white"
                    >
                      {['ACTIVE', 'SUSPENDED', 'BANNED'].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'finance' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
          <div className="px-4 py-3 border-b border-white/8 text-sm font-semibold text-white">
            Conciliación de Depósitos y Retiros (Sin modificación arbitraria de saldos reales)
          </div>
          <table className="w-full text-left text-xs min-w-[740px]">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-2.5 px-4">Entorno</th>
                <th className="py-2.5 px-4">Tipo</th>
                <th className="py-2.5 px-4">Activo / Red</th>
                <th className="py-2.5 px-4 text-right">Monto</th>
                <th className="py-2.5 px-4">TXID</th>
                <th className="py-2.5 px-4">Estado</th>
                <th className="py-2.5 px-4 text-right">Aprobación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono">
              {data.transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-2.5 px-4 font-sans font-bold text-white">{tx.env}</td>
                  <td className="py-2.5 px-4 font-sans text-slate-300">{tx.type}</td>
                  <td className="py-2.5 px-4 font-sans text-slate-300">
                    {tx.asset} · {tx.network}
                  </td>
                  <td className="py-2.5 px-4 text-right text-white">{tx.amount}</td>
                  <td className="py-2.5 px-4 text-slate-400 truncate max-w-[140px]">{tx.txid}</td>
                  <td className="py-2.5 px-4 font-sans text-amber-300">{tx.status}</td>
                  <td className="py-2.5 px-4 text-right font-sans">
                    {(tx.status === 'PENDING' || tx.status === 'FLAGGED') ? (
                      <div className="inline-flex gap-1.5">
                        <button onClick={() => handleTxAction(tx.id, 'APPROVE')} className="p-1 rounded bg-emerald-600 text-white cursor-pointer" title="Aprobar">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleTxAction(tx.id, 'REJECT')} className="p-1 rounded bg-red-600 text-white cursor-pointer" title="Rechazar">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'exchange' && (
        <div className="space-y-4">
          <form onSubmit={handleAddMarket} className="rounded-xl border border-white/10 bg-[#111520] p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Nuevo Par (ej. AVAX/USDT)</label>
              <input
                type="text"
                required
                value={newPair}
                onChange={(e) => setNewPair(e.target.value)}
                placeholder="AVAX/USDT"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Precio Base Ref.</label>
              <input
                type="number"
                step="any"
                required
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Max Leverage</label>
              <input
                type="number"
                min="1"
                max="125"
                value={newLev}
                onChange={(e) => setNewLev(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white"
              />
            </div>
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white cursor-pointer">
              <Plus className="h-3.5 w-3.5" /> Agregar Mercado
            </button>
          </form>

          <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-white/8 text-[11px] text-slate-400">
                  <th className="py-2.5 px-4">Par</th>
                  <th className="py-2.5 px-4">Spot</th>
                  <th className="py-2.5 px-4">Futuros</th>
                  <th className="py-2.5 px-4">Max Apalancamiento</th>
                  <th className="py-2.5 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {data.markets.map((m) => (
                  <tr key={m.symbol}>
                    <td className="py-2.5 px-4 font-semibold text-white">{m.symbol}</td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => toggleMarket(m.symbol, { spotEnabled: m.spot_enabled === 0 })}
                        className={`px-2 py-1 rounded text-[11px] cursor-pointer ${m.spot_enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-slate-400'}`}
                      >
                        {m.spot_enabled ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => toggleMarket(m.symbol, { futuresEnabled: m.futures_enabled === 0 })}
                        className={`px-2 py-1 rounded text-[11px] cursor-pointer ${m.futures_enabled ? 'bg-violet-500/15 text-violet-300' : 'bg-white/10 text-slate-400'}`}
                      >
                        {m.futures_enabled ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-white">{m.max_leverage}x</td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => toggleMarket(m.symbol, { active: m.active === 0 })}
                        className={`px-2 py-1 rounded text-[11px] cursor-pointer ${m.active ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {m.active ? 'Publicado' : 'Pausado'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
          <div className="text-sm font-bold text-white">Arquitectura de Inteligencia Artificial Multi-Proveedor</div>
          <p className="text-xs text-slate-400">
            Las claves API se administran únicamente mediante variables de entorno del servidor (Secrets) y nunca se exponen al navegador.
          </p>
          <div className="divide-y divide-white/6 text-xs">
            {data.providers.map((p) => (
              <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">
                    {p.name} <span className="font-mono text-slate-400">({p.model})</span>
                  </div>
                  <div className="text-slate-500">
                    Prioridad #{p.priority} · Límite {p.max_rpm} req/min · Estado: {p.status}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleProvider(p.id, p.enabled === 0)}
                  className={`rounded-lg px-3 py-1.5 font-semibold cursor-pointer ${
                    p.enabled ? 'bg-emerald-600 text-white' : 'bg-white/10 text-slate-400'
                  }`}
                >
                  {p.enabled ? 'Habilitado' : 'En Reserva'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'demo' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-white">Parámetros del Modo DEMO</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Capital Inicial (USDT)</label>
                <input
                  type="number"
                  defaultValue={data.configs.demo_settings.initialCapital}
                  id="demoCap"
                  className="w-full rounded border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Slippage Simulado (bps)</label>
                <input
                  type="number"
                  defaultValue={data.configs.demo_settings.slippageBps}
                  id="demoSlip"
                  className="w-full rounded border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const cap = Number((document.getElementById('demoCap') as HTMLInputElement).value);
                const slip = Number((document.getElementById('demoSlip') as HTMLInputElement).value);
                updateConfig('demo_settings', { ...data.configs.demo_settings, initialCapital: cap, slippageBps: slip });
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white cursor-pointer"
            >
              Guardar Reglas DEMO
            </button>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-white">Acceso Rápido a Quick Trading Pro</h3>
            <p className="text-slate-400">
              Administra colores térmicos, payouts por activo y duración, límites, proveedores de precios y auditoría completa en la pestaña dedicada.
            </p>
            <button
              type="button"
              onClick={() => setTab('quick_trading')}
              className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white cursor-pointer"
            >
              Ir a Configuración Quick Trading Pro
            </button>
          </div>
        </div>
      )}

      {tab === 'quick_trading' && qtDraft && (
        <div className="space-y-5 text-xs">
          {/* Global vs DEMO vs REAL Statistics */}
          {qtAdminData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(
                [
                  { title: 'Estadísticas Globales', item: qtAdminData.stats.global, accent: 'text-sky-400' },
                  { title: 'Entorno DEMO', item: qtAdminData.stats.demo, accent: 'text-amber-300' },
                  { title: 'Entorno REAL', item: qtAdminData.stats.real, accent: 'text-emerald-400' },
                ] as const
              ).map(({ title, item, accent }) => (
                <div key={title} className="rounded-xl border border-white/10 bg-[#111520] p-4 space-y-2">
                  <div className={`font-bold text-sm ${accent}`}>{title}</div>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <div>
                      <div className="text-[10px] font-sans text-slate-400">Operaciones</div>
                      <div className="text-white font-bold">{item.total}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans text-slate-400">Win Rate</div>
                      <div className="text-white font-bold">{item.winRatePct}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans text-slate-400">Volumen</div>
                      <div className="text-white font-bold">${formatCurrency(item.totalVolume, 0)}</div>
                    </div>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-white/8 font-mono text-[11px]">
                    <span className="text-slate-400">
                      G:{item.wins} · P:{item.losses} · C:{item.cancelled}
                    </span>
                    <span className={item.traderNetPnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                      PnL Traders: {item.traderNetPnl >= 0 ? '+' : ''}${item.traderNetPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Core Quick Trading Rules, Animations, Price Provider & Limits */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
              <div className="text-sm font-bold text-white">Parámetros Operativos & Proveedor de Precios</div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setQtDraft({ ...qtDraft, enabled: !qtDraft.enabled })}
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${
                    qtDraft.enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-[#090B10] text-slate-400'
                  }`}
                >
                  <div className="font-semibold">Módulo</div>
                  <div className="text-[11px]">{qtDraft.enabled ? 'Activo' : 'Desactivado'}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setQtDraft({ ...qtDraft, demoOnly: !qtDraft.demoOnly })}
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${
                    qtDraft.demoOnly ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                  }`}
                >
                  <div className="font-semibold">Restricción</div>
                  <div className="text-[11px]">{qtDraft.demoOnly ? 'Solo DEMO' : 'DEMO + REAL'}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setQtDraft({ ...qtDraft, animationsEnabled: !qtDraft.animationsEnabled })}
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${
                    qtDraft.animationsEnabled ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-[#090B10] text-slate-400'
                  }`}
                >
                  <div className="font-semibold">Animaciones</div>
                  <div className="text-[11px]">{qtDraft.animationsEnabled ? 'Activadas' : 'Desactivadas'}</div>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Payout Base (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={98}
                    value={qtDraft.payoutPct}
                    onChange={(e) => setQtDraft({ ...qtDraft, payoutPct: Number(e.target.value) })}
                    className="w-full rounded border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Mínimo (USDT)</label>
                  <input
                    type="number"
                    min={1}
                    value={qtDraft.minAmount}
                    onChange={(e) => setQtDraft({ ...qtDraft, minAmount: Number(e.target.value) })}
                    className="w-full rounded border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Máximo (USDT)</label>
                  <input
                    type="number"
                    min={5}
                    value={qtDraft.maxAmount}
                    onChange={(e) => setQtDraft({ ...qtDraft, maxAmount: Number(e.target.value) })}
                    className="w-full rounded border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Proveedor de Precios</label>
                <select
                  value={qtDraft.priceProvider}
                  onChange={(e) =>
                    setQtDraft({
                      ...qtDraft,
                      priceProvider: e.target.value as QuickTradeConfig['priceProvider'],
                    })
                  }
                  className="w-full rounded border border-white/10 bg-[#090B10] px-3 py-2 text-white"
                >
                  <option value="AUTO">AUTO (Binance Público con respaldo simulado)</option>
                  <option value="BINANCE_PUBLIC">BINANCE_PUBLIC (Priorizar cotización pública)</option>
                  <option value="SIMULATED_FEED">SIMULATED_FEED (Motor interno DEMO)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5">Duraciones Habilitadas</label>
                <div className="flex flex-wrap gap-1.5">
                  {[15, 30, 60, 180, 300, 600].map((sec) => {
                    const active = qtDraft.durations.includes(sec);
                    return (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? qtDraft.durations.filter((d) => d !== sec)
                            : [...qtDraft.durations, sec].sort((a, b) => a - b);
                          if (next.length > 0) setQtDraft({ ...qtDraft, durations: next });
                        }}
                        className={`px-3 py-1.5 rounded font-mono cursor-pointer border ${
                          active ? 'bg-blue-600 border-blue-500 text-white font-semibold' : 'bg-[#090B10] border-white/10 text-slate-400'
                        }`}
                      >
                        {formatDurationLabel(sec)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Thermal Colors & Per-Asset / Per-Duration Payouts */}
            <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-white">Colores Térmicos & Payout Granular</div>
                <button
                  type="button"
                  onClick={() => setQtDraft({ ...qtDraft, thermalColors: { ...DEFAULT_THERMAL_COLORS } })}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" /> Restaurar colores
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(
                  [
                    ['highProfit', 'Ganancia Intensa'],
                    ['lowProfit', 'Ganancia Suave'],
                    ['neutral', 'Equilibrio'],
                    ['moderateLoss', 'Pérdida Mod.'],
                    ['highLoss', 'Pérdida Intensa'],
                    ['pending', 'Neutral / Azul'],
                    ['aiAccent', 'Acento IA'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 rounded bg-[#090B10] border border-white/8 px-2 py-1.5 cursor-pointer">
                    <input
                      type="color"
                      value={qtDraft.thermalColors[k]}
                      onChange={(e) =>
                        setQtDraft({
                          ...qtDraft,
                          thermalColors: { ...qtDraft.thermalColors, [k]: e.target.value },
                        })
                      }
                      className="h-5 w-6 bg-transparent border-0 cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-300 truncate">{label}</span>
                  </label>
                ))}
              </div>

              {/* Per-Asset Payouts */}
              <div className="space-y-1.5">
                <div className="text-slate-400">Payout por Activo (%)</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {data.markets.slice(0, 8).map((m) => (
                    <div key={m.symbol} className="flex items-center justify-between gap-1 rounded bg-[#090B10] border border-white/8 px-2 py-1">
                      <span className="font-mono text-[10px] text-slate-300">{m.base}</span>
                      <input
                        type="number"
                        min={50}
                        max={98}
                        placeholder={String(qtDraft.payoutPct)}
                        value={qtDraft.assetPayouts[m.symbol] ?? ''}
                        onChange={(e) => {
                          const next = { ...qtDraft.assetPayouts };
                          if (!e.target.value) delete next[m.symbol];
                          else next[m.symbol] = Number(e.target.value);
                          setQtDraft({ ...qtDraft, assetPayouts: next });
                        }}
                        className="w-12 bg-transparent text-right font-mono text-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-Duration Payouts */}
              <div className="space-y-1.5">
                <div className="text-slate-400">Payout por Duración (%)</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {qtDraft.durations.map((sec) => (
                    <div key={sec} className="flex items-center justify-between gap-1 rounded bg-[#090B10] border border-white/8 px-2 py-1">
                      <span className="font-mono text-[10px] text-slate-300">{formatDurationLabel(sec)}</span>
                      <input
                        type="number"
                        min={50}
                        max={98}
                        placeholder={String(qtDraft.payoutPct)}
                        value={qtDraft.durationPayouts[String(sec)] ?? ''}
                        onChange={(e) => {
                          const next = { ...qtDraft.durationPayouts };
                          if (!e.target.value) delete next[String(sec)];
                          else next[String(sec)] = Number(e.target.value);
                          setQtDraft({ ...qtDraft, durationPayouts: next });
                        }}
                        className="w-10 bg-transparent text-right font-mono text-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  await updateConfig('quick_trading', qtDraft);
                  loadQuickTradingAdmin(qtEnvFilter);
                }}
                className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 py-2.5 font-semibold text-white cursor-pointer"
              >
                Guardar Configuración Quick Trading Pro (Auditado)
              </button>
            </div>
          </div>

          {/* Global DEMO / REAL Operations Inspector & CSV Export */}
          <div className="rounded-xl border border-white/10 bg-[#111520] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
              <div className="font-bold text-sm text-white">Registro Global de Operaciones Quick Trading</div>
              <div className="flex flex-wrap items-center gap-2">
                {(['ALL', 'DEMO', 'REAL'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setQtEnvFilter(e);
                      loadQuickTradingAdmin(e);
                    }}
                    className={`px-2.5 py-1 rounded font-mono cursor-pointer ${
                      qtEnvFilter === e ? 'bg-violet-600 text-white font-semibold' : 'bg-[#090B10] text-slate-400 border border-white/10'
                    }`}
                  >
                    {e === 'ALL' ? 'DEMO + REAL' : e}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={async () => {
                    const token = getStoredToken();
                    const res = await fetch(`/api/superadmin/quick-trades/export-csv?env=${qtEnvFilter}`, {
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `superadmin-quick-trades-${qtEnvFilter.toLowerCase()}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    loadQuickTradingAdmin(qtEnvFilter);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 font-semibold text-white cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" /> Exportar CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[780px]">
                <thead>
                  <tr className="border-b border-white/8 text-[11px] text-slate-400">
                    <th className="py-2 px-4">ID / Fecha</th>
                    <th className="py-2 px-4">Usuario</th>
                    <th className="py-2 px-4">Cuenta</th>
                    <th className="py-2 px-4">Par / Dir</th>
                    <th className="py-2 px-4 text-right">Importe</th>
                    <th className="py-2 px-4 text-right">Entrada → Cierre</th>
                    <th className="py-2 px-4">Estado</th>
                    <th className="py-2 px-4 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6 font-mono">
                  {(qtAdminData?.trades || []).slice(0, 30).map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 px-4 text-[11px]">
                        <div className="text-slate-200">{t.id}</div>
                        <div className="text-slate-500">{new Date(t.created_at).toLocaleString('es-ES')}</div>
                      </td>
                      <td className="py-2 px-4 font-sans text-slate-300">{t.user_email || t.user_id}</td>
                      <td className="py-2 px-4 font-bold">{t.env}</td>
                      <td className="py-2 px-4">
                        {t.symbol} <span className={t.direction === 'UP' ? 'text-emerald-400' : 'text-red-400'}>{t.direction}</span>
                      </td>
                      <td className="py-2 px-4 text-right">${t.amount.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">
                        ${formatPrice(t.entry_price)} → {t.close_price > 0 ? `$${formatPrice(t.close_price)}` : '—'}
                      </td>
                      <td className="py-2 px-4">{t.status}</td>
                      <td className={`py-2 px-4 text-right font-semibold ${t.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.profit >= 0 ? '+' : ''}
                        {t.profit.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Trading Audit Log */}
          <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
            <div className="px-4 py-3 border-b border-white/8 font-bold text-sm text-white">
              Auditoría de Cambios Quick Trading
            </div>
            <table className="w-full text-left min-w-[680px]">
              <thead>
                <tr className="border-b border-white/8 text-[11px] text-slate-400">
                  <th className="py-2 px-4">Fecha</th>
                  <th className="py-2 px-4">Admin</th>
                  <th className="py-2 px-4">Acción</th>
                  <th className="py-2 px-4">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {(qtAdminData?.auditLogs || []).map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 px-4 font-mono text-slate-400">{new Date(a.created_at).toLocaleString('es-ES')}</td>
                    <td className="py-2 px-4 text-white">{a.admin_email}</td>
                    <td className="py-2 px-4 font-semibold text-violet-300">{a.action}</td>
                    <td className="py-2 px-4 font-mono text-slate-400 truncate max-w-md">{a.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'modules' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
          <div className="text-sm font-bold text-white">Habilitación Dinámica de Módulos (Sin editar código)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            {Object.entries(data.configs.enabled_modules).map(([modKey, enabled]) => (
              <button
                key={modKey}
                type="button"
                onClick={() =>
                  updateConfig('enabled_modules', { ...data.configs.enabled_modules, [modKey]: !enabled })
                }
                className={`rounded-lg border p-3 text-left cursor-pointer ${
                  enabled ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-[#090B10] text-slate-500'
                }`}
              >
                <div className="font-semibold capitalize">{modKey}</div>
                <div className="text-[11px] mt-0.5">{enabled ? 'Habilitado' : 'Desactivado'}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'referrals' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3 text-xs">
          <div className="text-sm font-bold text-white">Mensajes Reportados en Comunidad ({data.reportedMsgs.length})</div>
          {data.reportedMsgs.length === 0 ? (
            <p className="text-slate-400">Sin reportes pendientes de moderación.</p>
          ) : (
            <div className="divide-y divide-white/6">
              {data.reportedMsgs.map((m) => (
                <div key={m.id} className="py-2 flex justify-between">
                  <span>
                    <strong className="text-white">{m.author_name}</strong> ({m.room}): {m.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
