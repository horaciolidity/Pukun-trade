import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Check, X, Download, RotateCcw, Percent, Megaphone, Gift, Calendar, Trash2, Users, Wallet, Search, RefreshCw, Upload, Sparkles } from 'lucide-react';
import { apiFetch, formatCurrency, formatPrice, getStoredToken, resolveIpfsUrl } from '../api';
import {
  adminAdjustUserBalance,
  adminFetchAllUsersAndTxs,
  adminReviewTransaction,
  AdminSupabaseTxRow,
  AdminSupabaseUserRow,
  DEFAULT_DEPOSIT_GATEWAY_CONFIG,
  DepositGatewayConfig,
  fetchDepositGatewayConfig,
  saveDepositGatewayConfig,
} from '../supabase';
import {
  AdminFutureEvent,
  AdminMissionTask,
  AdminPlatformFees,
  AdminPromoBanner,
  Market,
  MissionPlatform,
  NavSection,
  QuickTradeItem,
  UserRole,
} from '../types';
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
    fees?: AdminPlatformFees;
    promo_banners?: AdminPromoBanner[];
    future_events?: AdminFutureEvent[];
    missions?: AdminMissionTask[];
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
  { id: 'supabase_crm', label: 'Usuarios, Saldos & Depósitos' },
  { id: 'pukun_control', label: 'Comisiones, Banners & Eventos' },
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
  const [tab, setTab] = useState('supabase_crm');
  const [sbUsers, setSbUsers] = useState<AdminSupabaseUserRow[]>([]);
  const [sbTxs, setSbTxs] = useState<AdminSupabaseTxRow[]>([]);
  const [sbWarning, setSbWarning] = useState('');
  const [sbLoading, setSbLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [adjUserId, setAdjUserId] = useState('');
  const [adjEnv, setAdjEnv] = useState<'REAL' | 'DEMO'>('REAL');
  const [adjAsset, setAdjAsset] = useState('USDT');
  const [adjMode, setAdjMode] = useState<'ADD' | 'SUB' | 'SET'>('ADD');
  const [adjAmount, setAdjAmount] = useState('100');
  const [depositCfg, setDepositCfg] = useState<DepositGatewayConfig>(DEFAULT_DEPOSIT_GATEWAY_CONFIG);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [qtDraft, setQtDraft] = useState<QuickTradeConfig | null>(null);
  const [feesDraft, setFeesDraft] = useState<AdminPlatformFees>({
    spotMakerPct: 0.08,
    spotTakerPct: 0.1,
    futuresFeePct: 0.05,
    withdrawFeeUsdt: 1.5,
    withdrawFeePct: 0.1,
  });
  const [refRewardDraft, setRefRewardDraft] = useState(40);
  const [refCommDraft, setRefCommDraft] = useState(20);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerSubtitle, setBannerSubtitle] = useState('');
  const [bannerBadge, setBannerBadge] = useState('PROMO PUKUN');
  const [bannerCta, setBannerCta] = useState('Probar Ahora');
  const [bannerTarget, setBannerTarget] = useState<NavSection>('quick-trade');
  const [bannerImage, setBannerImage] = useState('/banner-trading.jpg');
  const [evtTitle, setEvtTitle] = useState('');
  const [evtReward, setEvtReward] = useState('1000');
  const [evtStart, setEvtStart] = useState('2026-12-01');
  const [evtEnd, setEvtEnd] = useState('2026-12-31');
  const [evtDesc, setEvtDesc] = useState('');
  const [ipfsUploading, setIpfsUploading] = useState(false);
  const [misPlatform, setMisPlatform] = useState<MissionPlatform>('TIKTOK');
  const [misTitle, setMisTitle] = useState('');
  const [misDesc, setMisDesc] = useState('');
  const [misReward, setMisReward] = useState('15');
  const [misUrl, setMisUrl] = useState('');
  const [misRequiresProof, setMisRequiresProof] = useState(true);
  const [misBannerImg, setMisBannerImg] = useState('/og-ref-40usdt.jpg');

  async function handleIpfsUploadFile(file: File, onDone: (url: string, cid?: string) => void) {
    setIpfsUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch<{ cid?: string; ipfsUri?: string; gatewayUrl: string; note?: string }>(
        '/api/ipfs/upload',
        {
          method: 'POST',
          body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: dataUrl }),
        }
      );
      onDone(res.ipfsUri || res.gatewayUrl, res.cid);
      setFeedback(
        res.cid
          ? `Imagen subida a IPFS (CID: ${res.cid}).`
          : res.note || 'Imagen cargada correctamente en el banner.'
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Error subiendo imagen a IPFS');
    } finally {
      setIpfsUploading(false);
    }
  }
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
      if (res.configs.fees) setFeesDraft(res.configs.fees);
      if (res.configs.referral_settings) {
        setRefRewardDraft(res.configs.referral_settings.inviteRewardUsdt ?? 40);
        setRefCommDraft(res.configs.referral_settings.commissionPct ?? 20);
      }
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

  async function loadSupabaseCrm() {
    setSbLoading(true);
    try {
      const [{ users, transactions, warning }, depCfg] = await Promise.all([
        adminFetchAllUsersAndTxs(),
        fetchDepositGatewayConfig(),
      ]);
      setSbUsers(users);
      setSbTxs(transactions);
      setSbWarning(warning || '');
      setDepositCfg(depCfg);
      if (users.length > 0 && !adjUserId) {
        setAdjUserId(users[0].id);
      }
    } finally {
      setSbLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
    loadQuickTradingAdmin('ALL');
    loadSupabaseCrm();
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
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${tab === t.id ? 'bg-violet-600 text-white' : 'bg-[#111520] border border-white/10 text-slate-400 hover:text-white'
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
                  className={`rounded-lg px-3 py-1.5 font-semibold cursor-pointer ${p.enabled ? 'bg-emerald-600 text-white' : 'bg-white/10 text-slate-400'
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
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${qtDraft.enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-[#090B10] text-slate-400'
                    }`}
                >
                  <div className="font-semibold">Módulo</div>
                  <div className="text-[11px]">{qtDraft.enabled ? 'Activo' : 'Desactivado'}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setQtDraft({ ...qtDraft, demoOnly: !qtDraft.demoOnly })}
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${qtDraft.demoOnly ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    }`}
                >
                  <div className="font-semibold">Restricción</div>
                  <div className="text-[11px]">{qtDraft.demoOnly ? 'Solo DEMO' : 'DEMO + REAL'}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setQtDraft({ ...qtDraft, animationsEnabled: !qtDraft.animationsEnabled })}
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${qtDraft.animationsEnabled ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-[#090B10] text-slate-400'
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
                        className={`px-3 py-1.5 rounded font-mono cursor-pointer border ${active ? 'bg-blue-600 border-blue-500 text-white font-semibold' : 'bg-[#090B10] border-white/10 text-slate-400'
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
                    className={`px-2.5 py-1 rounded font-mono cursor-pointer ${qtEnvFilter === e ? 'bg-violet-600 text-white font-semibold' : 'bg-[#090B10] text-slate-400 border border-white/10'
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

      {tab === 'supabase_crm' && (
        <div className="space-y-6">
          {sbWarning && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-200">
              {sbWarning}
            </div>
          )}

          {/* 1. All Subscribed Users & Real Balances */}
          <div className="rounded-xl border border-amber-500/25 bg-[#111520] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Users className="h-4 w-4 text-amber-400" />
                <span>Todos los Correos Suscritos y Saldos ({sbUsers.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Buscar correo o nombre..."
                    className="rounded-lg border border-white/10 bg-[#090B10] pl-8 pr-3 py-1.5 text-xs text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadSupabaseCrm}
                  disabled={sbLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sbLoading ? 'animate-spin' : ''}`} />
                  <span>Actualizar</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/8">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090B10] text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3">Correo / Usuario</th>
                    <th className="py-2.5 px-3">Rol</th>
                    <th className="py-2.5 px-3 text-right">Saldo REAL (USDT)</th>
                    <th className="py-2.5 px-3 text-right">Saldo DEMO (USDT)</th>
                    <th className="py-2.5 px-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {sbUsers
                    .filter((u) => {
                      const q = userSearch.trim().toLowerCase();
                      if (!q) return true;
                      return u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q);
                    })
                    .map((u) => {
                      const realUsdt = u.wallets.find((w) => w.env === 'REAL' && w.asset === 'USDT')?.available ?? 0;
                      const demoUsdt = u.wallets.find((w) => w.env === 'DEMO' && w.asset === 'USDT')?.available ?? 0;
                      return (
                        <tr key={u.id} className="hover:bg-white/2">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-white">{u.email}</div>
                            <div className="text-[10px] text-slate-400">
                              {u.full_name} · Ref: <span className="font-mono">{u.referral_code || '—'}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-bold ${u.role === 'SUPERADMIN'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-white/10 text-slate-300'
                                }`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                            ${formatCurrency(realUsdt)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-300">
                            ${formatCurrency(demoUsdt)}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => setAdjUserId(u.id)}
                              className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20 cursor-pointer"
                            >
                              Editar Saldo
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {sbUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No hay usuarios cargados aún (o falta ejecutar el SQL de permisos Superadmin en Supabase).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Balance Modifier Form */}
            <div className="rounded-xl border border-cyan-500/25 bg-[#090B10] p-4 space-y-3">
              <div className="text-xs font-bold text-cyan-300">
                Modificar / Acreditar / Descontar Saldo de Usuario
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 text-xs">
                <select
                  value={adjUserId}
                  onChange={(e) => setAdjUserId(e.target.value)}
                  className="sm:col-span-2 rounded-lg border border-white/10 bg-[#111520] px-2.5 py-2 text-white"
                >
                  <option value="">Selecciona un correo...</option>
                  {sbUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
                <select
                  value={adjEnv}
                  onChange={(e) => setAdjEnv(e.target.value as 'REAL' | 'DEMO')}
                  className="rounded-lg border border-white/10 bg-[#111520] px-2.5 py-2 text-white"
                >
                  <option value="REAL">Saldo REAL</option>
                  <option value="DEMO">Saldo DEMO</option>
                </select>
                <select
                  value={adjAsset}
                  onChange={(e) => setAdjAsset(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#111520] px-2.5 py-2 text-white"
                >
                  <option value="USDT">USDT</option>
                  <option value="BTC">BTC</option>
                  <option value="ETH">ETH</option>
                  <option value="SOL">SOL</option>
                  <option value="CAIX">CAIX</option>
                </select>
                <select
                  value={adjMode}
                  onChange={(e) => setAdjMode(e.target.value as 'ADD' | 'SUB' | 'SET')}
                  className="rounded-lg border border-white/10 bg-[#111520] px-2.5 py-2 text-white"
                >
                  <option value="ADD">Sumar (+)</option>
                  <option value="SUB">Restar (-)</option>
                  <option value="SET">Fijar Exacto (=)</option>
                </select>
                <input
                  type="number"
                  step="any"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="Monto"
                  className="rounded-lg border border-white/10 bg-[#111520] px-2.5 py-2 font-mono text-white"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!adjUserId) {
                    setFeedback('Selecciona un usuario primero.');
                    return;
                  }
                  try {
                    const nextBal = await adminAdjustUserBalance({
                      userId: adjUserId,
                      env: adjEnv,
                      asset: adjAsset,
                      mode: adjMode,
                      amount: Number(adjAmount),
                    });
                    setFeedback(`Saldo ${adjEnv} (${adjAsset}) actualizado correctamente. Nuevo saldo: ${nextBal}`);
                    loadSupabaseCrm();
                  } catch (err) {
                    setFeedback(err instanceof Error ? err.message : 'Error modificando saldo');
                  }
                }}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 cursor-pointer"
              >
                Aplicar Cambio de Saldo en Supabase
              </button>
            </div>
          </div>

          {/* 2. Deposit & Withdrawal Approvals */}
          <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white">
                Aprobación / Desaprobación de Depósitos y Retiros ({sbTxs.length})
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/8">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090B10] text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3">Usuario</th>
                    <th className="py-2.5 px-3">Tipo / Red</th>
                    <th className="py-2.5 px-3 text-right">Monto</th>
                    <th className="py-2.5 px-3">TXID</th>
                    <th className="py-2.5 px-3">Estado</th>
                    <th className="py-2.5 px-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {sbTxs.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2.5 px-3 text-white font-medium">{tx.user_email}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-amber-300">{tx.type}</span> · {tx.env} · {tx.network}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                        {tx.amount} {tx.asset}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400 max-w-36 truncate">
                        {tx.txid || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${tx.status === 'COMPLETED'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : tx.status === 'REJECTED'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-amber-500/20 text-amber-300'
                            }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {tx.status === 'PENDING' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminReviewTransaction(tx, 'APPROVE');
                                  setFeedback(`Depósito/Transacción aprobada y saldo acreditado (${tx.amount} ${tx.asset}).`);
                                  loadSupabaseCrm();
                                } catch (err) {
                                  setFeedback(err instanceof Error ? err.message : 'Error al aprobar');
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 cursor-pointer"
                            >
                              <Check className="h-3 w-3" />
                              <span>Aprobar</span>
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminReviewTransaction(tx, 'REJECT');
                                  setFeedback(`Transacción rechazada.`);
                                  loadSupabaseCrm();
                                } catch (err) {
                                  setFeedback(err instanceof Error ? err.message : 'Error al rechazar');
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded bg-red-600/80 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-500 cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                              <span>Rechazar</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500">Procesada</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sbTxs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        Sin depósitos o retiros registrados todavía.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Master Deposit Addresses & Gateway Configuration */}
          <div className="rounded-xl border border-amber-500/25 bg-[#111520] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <Wallet className="h-4 w-4" />
              <span>Tus Direcciones de Recepción (Master Wallets) & Pasarela Multi-Red</span>
            </div>
            <p className="text-xs text-slate-400">
              Coloca aquí tus direcciones reales (de Binance, Trust Wallet, MetaMask, Ledger o TronLink) para recibir los depósitos de tus usuarios, o selecciona una pasarela de direcciones estáticas por usuario (OxaPay / Cryptomus / NOWPayments).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Modo de Depósitos</label>
                <select
                  value={depositCfg.provider}
                  onChange={(e) =>
                    setDepositCfg({
                      ...depositCfg,
                      provider: e.target.value as DepositGatewayConfig['provider'],
                    })
                  }
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
                >
                  <option value="DIRECT_MASTER">Directo a tus Master Wallets + Aprobación TXID (Activo Ya)</option>
                  <option value="OXAPAY">OxaPay Static Address API (1 address por usuario)</option>
                  <option value="CRYPTOMUS">Cryptomus Static Wallets API (1 address por usuario)</option>
                  <option value="NOWPAYMENTS">NOWPayments Custody API (1 address por usuario)</option>
                </select>
              </div>
              {Object.keys(DEFAULT_DEPOSIT_GATEWAY_CONFIG.masterAddresses).map((net) => (
                <div key={net}>
                  <label className="block text-slate-400 mb-1">Tu Dirección {net}</label>
                  <input
                    type="text"
                    value={depositCfg.masterAddresses[net] || ''}
                    onChange={(e) =>
                      setDepositCfg({
                        ...depositCfg,
                        masterAddresses: { ...depositCfg.masterAddresses, [net]: e.target.value },
                      })
                    }
                    placeholder={`Pega tu address real de ${net}...`}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await saveDepositGatewayConfig(depositCfg);
                  setFeedback('Tus Master Deposit Addresses y pasarela se guardaron correctamente.');
                } catch (err) {
                  setFeedback(err instanceof Error ? err.message : 'Error guardando direcciones');
                }
              }}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
            >
              Guardar Mis Direcciones de Depósito
            </button>
          </div>
        </div>
      )}

      {tab === 'pukun_control' && (
        <div className="space-y-6">
          {/* 1. Commissions & Referral Rewards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-amber-500/25 bg-[#111520] p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                <Percent className="h-4 w-4" />
                <span>Comisiones de Trades y Retiros</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Spot Maker (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={feesDraft.spotMakerPct}
                    onChange={(e) => setFeesDraft({ ...feesDraft, spotMakerPct: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Spot Taker (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={feesDraft.spotTakerPct}
                    onChange={(e) => setFeesDraft({ ...feesDraft, spotTakerPct: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Futuros (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={feesDraft.futuresFeePct}
                    onChange={(e) => setFeesDraft({ ...feesDraft, futuresFeePct: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Retiro Fijo (USDT)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={feesDraft.withdrawFeeUsdt}
                    onChange={(e) => setFeesDraft({ ...feesDraft, withdrawFeeUsdt: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Retiro Variable (%)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={feesDraft.withdrawFeePct}
                    onChange={(e) => setFeesDraft({ ...feesDraft, withdrawFeePct: Number(e.target.value) })}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => updateConfig('fees', feesDraft)}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                Guardar Comisiones Globales
              </button>
            </div>

            <div className="rounded-xl border border-cyan-500/25 bg-[#111520] p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                <Gift className="h-4 w-4" />
                <span>Premios de Referidos (Se refleja en Header y Banners)</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Premio por Referido (USDT)</label>
                  <input
                    type="number"
                    value={refRewardDraft}
                    onChange={(e) => setRefRewardDraft(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Comisión por Trades (%)</label>
                  <input
                    type="number"
                    value={refCommDraft}
                    onChange={(e) => setRefCommDraft(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-2 font-mono text-white"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateConfig('referral_settings', {
                    ...data.configs.referral_settings,
                    inviteRewardUsdt: refRewardDraft,
                    commissionPct: refCommDraft,
                  })
                }
                className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 cursor-pointer"
              >
                Actualizar Premio de Referidos
              </button>
            </div>
          </div>

          {/* 2. Dynamic Promo Banners Manager */}
          <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Megaphone className="h-4 w-4 text-amber-400" />
              <span>Gestor de Banners Publicitarios (Visibles en Dashboard)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <input
                type="text"
                value={bannerBadge}
                onChange={(e) => setBannerBadge(e.target.value)}
                placeholder="Etiqueta (ej. NUEVO EVENTO)"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="text"
                value={bannerTitle}
                onChange={(e) => setBannerTitle(e.target.value)}
                placeholder="Título del Banner..."
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="text"
                value={bannerSubtitle}
                onChange={(e) => setBannerSubtitle(e.target.value)}
                placeholder="Subtítulo breve..."
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="text"
                value={bannerCta}
                onChange={(e) => setBannerCta(e.target.value)}
                placeholder="Texto del botón (ej. Probar Ahora)"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <select
                value={bannerTarget}
                onChange={(e) => setBannerTarget(e.target.value as NavSection)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              >
                <option value="quick-trade">Ir a Quick Trading</option>
                <option value="futures">Ir a Futuros 125x</option>
                <option value="spot">Ir a Spot</option>
                <option value="bots">Ir a Bots IA</option>
                <option value="referrals">Ir a Referidos</option>
                <option value="launchpad">Ir a Launchpad</option>
              </select>
              <select
                value={bannerImage}
                onChange={(e) => setBannerImage(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              >
                <option value="/og-ref-40usdt.jpg">Arte: Referidos 40 USDT</option>
                <option value="/banner-trading.jpg">Arte: Trading Pro</option>
                <option value="/banner-bots.jpg">Arte: Bots IA</option>
                <option value="/banner-wallet.jpg">Arte: Wallet Vault</option>
                <option value="/banner-launchpad.jpg">Arte: Launchpad</option>
                <option value={bannerImage}>{bannerImage.startsWith('ipfs://') || bannerImage.startsWith('http') || bannerImage.startsWith('data:') ? 'Imagen IPFS / Subida' : 'Personalizada'}</option>
              </select>
            </div>

            {/* IPFS Image Uploader / CID Input for Banner */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-cyan-500/25 bg-[#090B10] p-3 text-xs">
              <label className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 font-semibold text-cyan-200 hover:bg-cyan-500/30 cursor-pointer shrink-0">
                <Upload className="h-3.5 w-3.5" />
                <span>{ipfsUploading ? 'Subiendo a IPFS...' : 'Subir Imagen a IPFS'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleIpfsUploadFile(f, (url) => setBannerImage(url));
                  }}
                />
              </label>
              <input
                type="text"
                value={bannerImage}
                onChange={(e) => setBannerImage(e.target.value)}
                placeholder="O pega un enlace ipfs://CID o URL de imagen..."
                className="flex-1 min-w-44 rounded-lg border border-white/10 bg-[#111520] px-3 py-1.5 font-mono text-[11px] text-slate-200"
              />
              {bannerImage && (
                <img
                  src={resolveIpfsUrl(bannerImage)}
                  alt="Preview IPFS"
                  className="h-9 w-16 rounded-md object-cover border border-white/15 shrink-0"
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!bannerTitle.trim()) return;
                const current = data.configs.promo_banners || [];
                const next: AdminPromoBanner[] = [
                  {
                    id: `promo_${Date.now()}`,
                    badge: bannerBadge,
                    title: bannerTitle,
                    subtitle: bannerSubtitle,
                    ctaText: bannerCta || 'Ver más',
                    targetTab: bannerTarget,
                    imageUrl: bannerImage,
                    active: true,
                    createdAt: Date.now(),
                  },
                  ...current,
                ];
                updateConfig('promo_banners', next);
                setBannerTitle('');
                setBannerSubtitle('');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Publicar Nuevo Banner</span>
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {(data.configs.promo_banners || []).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#090B10] p-3 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={resolveIpfsUrl(b.imageUrl)} alt={b.title} className="h-12 w-20 rounded-lg object-cover shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">{b.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">{b.badge} · Destino: {b.targetTab}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateConfig(
                        'promo_banners',
                        (data.configs.promo_banners || []).filter((x) => x.id !== b.id)
                      )
                    }
                    className="text-red-400 hover:text-red-300 cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Future Events & Prizes Manager */}
          <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Calendar className="h-4 w-4 text-emerald-400" />
              <span>Eventos Futuros y Premios en USDT</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <input
                type="text"
                value={evtTitle}
                onChange={(e) => setEvtTitle(e.target.value)}
                placeholder="Nombre del Evento..."
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="number"
                value={evtReward}
                onChange={(e) => setEvtReward(e.target.value)}
                placeholder="Premio USDT"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
              />
              <input
                type="date"
                value={evtStart}
                onChange={(e) => setEvtStart(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="date"
                value={evtEnd}
                onChange={(e) => setEvtEnd(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 text-xs">
              <input
                type="text"
                value={evtDesc}
                onChange={(e) => setEvtDesc(e.target.value)}
                placeholder="Descripción y reglas del premio..."
                className="flex-1 rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (!evtTitle.trim()) return;
                  const current = data.configs.future_events || [];
                  const next: AdminFutureEvent[] = [
                    {
                      id: `evt_${Date.now()}`,
                      title: evtTitle,
                      rewardUsdt: Number(evtReward || 500),
                      startDate: evtStart,
                      endDate: evtEnd,
                      description: evtDesc,
                      active: true,
                    },
                    ...current,
                  ];
                  updateConfig('future_events', next);
                  setEvtTitle('');
                  setEvtDesc('');
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Crear Evento</span>
              </button>
            </div>
            <div className="space-y-2">
              {(data.configs.future_events || []).map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#090B10] px-4 py-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-white">
                      {ev.title}{' '}
                      <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                        Premio: ${formatCurrency(ev.rewardUsdt)} USDT
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {ev.startDate} ➔ {ev.endDate} · {ev.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateConfig(
                        'future_events',
                        (data.configs.future_events || []).filter((x) => x.id !== ev.id)
                      )
                    }
                    className="text-red-400 hover:text-red-300 cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {/* 4. Configurable Missions & Crypto Rewards (TG, YT, X, IG, TikTok, Referrals) */}
          <div className="rounded-xl border border-amber-500/25 bg-[#111520] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <Sparkles className="h-4 w-4" />
              <span>Misiones, Redes Sociales & Campañas Cripto (TG, YT, X, IG, TikTok + IPFS)</span>
            </div>
            <p className="text-xs text-slate-400">
              Crea tareas como "Crea un TikTok de Pukun Trade y gana $15 USDT" o visitas a tus redes oficiales. Los usuarios las ven y reclaman en Referidos & Misiones.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <select
                value={misPlatform}
                onChange={(e) => setMisPlatform(e.target.value as MissionPlatform)}
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              >
                <option value="TIKTOK">TikTok (Crear Video)</option>
                <option value="TELEGRAM">Telegram (Visitar / Unirse)</option>
                <option value="YOUTUBE">YouTube (Suscribirse / Video)</option>
                <option value="X">X / Twitter (Seguir / Repost)</option>
                <option value="INSTAGRAM">Instagram (Seguir / Historia)</option>
                <option value="REFERRAL">Campaña Referidos</option>
                <option value="CUSTOM">Misión Personalizada</option>
              </select>
              <input
                type="text"
                value={misTitle}
                onChange={(e) => setMisTitle(e.target.value)}
                placeholder="Ej. Crea un TikTok de Pukun Trade y gana $15"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="number"
                step="0.5"
                value={misReward}
                onChange={(e) => setMisReward(e.target.value)}
                placeholder="Premio en USDT"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-white"
              />
              <input
                type="text"
                value={misDesc}
                onChange={(e) => setMisDesc(e.target.value)}
                placeholder="Instrucciones (incluye mencionar tu link referido)..."
                className="sm:col-span-2 rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
              <input
                type="url"
                value={misUrl}
                onChange={(e) => setMisUrl(e.target.value)}
                placeholder="URL red social (https://...)"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-white"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#090B10] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 px-3 py-1.5 font-semibold text-amber-200 hover:bg-amber-500/30 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{ipfsUploading ? 'Subiendo...' : 'Subir Imagen Campaña a IPFS'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleIpfsUploadFile(f, (url) => setMisBannerImg(url));
                    }}
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={misRequiresProof}
                    onChange={(e) => setMisRequiresProof(e.target.checked)}
                    className="rounded"
                  />
                  <span>Exigir enlace de prueba (ej. link del TikTok)</span>
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!misTitle.trim()) return;
                  const current = data.configs.missions || [];
                  const next: AdminMissionTask[] = [
                    {
                      id: `mis_${Date.now()}`,
                      platform: misPlatform,
                      title: misTitle,
                      description: misDesc || 'Completa esta misión con tu código de referido Pukun Trade.',
                      rewardUsdt: Number(misReward || 5),
                      rewardAsset: 'USDT',
                      actionUrl: misUrl,
                      requiresProof: misRequiresProof,
                      bannerImageUrl: misBannerImg,
                      active: true,
                      createdAt: Date.now(),
                    },
                    ...current,
                  ];
                  updateConfig('missions', next);
                  setMisTitle('');
                  setMisDesc('');
                  setMisUrl('');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Publicar Misión Cripto</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data.configs.missions || []).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#090B10] p-3 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {m.bannerImageUrl && (
                      <img
                        src={resolveIpfsUrl(m.bannerImageUrl)}
                        alt={m.title}
                        className="h-11 w-16 rounded-lg object-cover shrink-0 border border-white/10"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">
                          {m.platform}
                        </span>
                        <span className="font-mono font-bold text-emerald-400">+${m.rewardUsdt} {m.rewardAsset}</span>
                      </div>
                      <div className="font-semibold text-white truncate mt-0.5">{m.title}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateConfig(
                        'missions',
                        (data.configs.missions || []).filter((x) => x.id !== m.id)
                      )
                    }
                    className="text-red-400 hover:text-red-300 cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
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
                className={`rounded-lg border p-3 text-left cursor-pointer ${enabled ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-[#090B10] text-slate-500'
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
