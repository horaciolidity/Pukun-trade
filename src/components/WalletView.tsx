import { useEffect, useState } from 'react';
import { Copy, Check, RotateCcw, PlusCircle, ShieldAlert, Sparkles } from 'lucide-react';
import { apiFetch, formatCurrency } from '../api';
import { TradingEnv, WalletItem, WalletTransaction } from '../types';
import { QrMatrix } from './QrMatrix';

interface Props {
  env: TradingEnv;
  userId?: string;
  userEmail?: string;
  wallets: WalletItem[];
  summary: { totalUsdt: number; availableUsdt: number; lockedUsdt: number };
  transactions: WalletTransaction[];
  whitelist: Array<{ id: string; asset: string; network: string; address: string; label: string }>;
  onRefresh: () => void;
}

const NETWORKS = [
  'Tron',
  'BNB Smart Chain',
  'Ethereum',
  'Polygon',
  'Solana',
  'Bitcoin',
  'Base',
  'TON',
];

export function WalletView({ env, userId, userEmail, wallets, summary, transactions, whitelist, onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<'balances' | 'deposit' | 'withdraw' | 'whitelist'>('balances');
  const [selectedAsset, setSelectedAsset] = useState('USDT');
  const [selectedNetwork, setSelectedNetwork] = useState('Tron');
  const [oxaAddresses, setOxaAddresses] = useState<Record<string, string>>({});
  const [oxaLoading, setOxaLoading] = useState(false);
  const [oxaError, setOxaError] = useState('');
  const [depositAmount, setDepositAmount] = useState('1000');
  const [depositTxid, setDepositTxid] = useState('');
  const [withdrawAddr, setWithdrawAddr] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [withdraw2fa, setWithdraw2fa] = useState('');
  const [wlLabel, setWlLabel] = useState('');
  const [wlAddr, setWlAddr] = useState('');
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const currentWallet = wallets.find((w) => w.asset === selectedAsset) || wallets[0];
  const oxaAddressForNet = oxaAddresses[selectedNetwork] || '';
  // In REAL mode, NEVER display mock/placeholder addresses — only show real OxaPay static address
  const depositAddress =
    env === 'REAL'
      ? oxaAddressForNet
      : currentWallet?.addresses?.[selectedNetwork] ||
        currentWallet?.addresses?.[`${selectedNetwork} (TRC-20)`] ||
        currentWallet?.addresses?.Ethereum ||
        'DEMO-VIRTUAL-WALLET';

  async function fetchOxaStaticAddress(net = selectedNetwork, asset = selectedAsset) {
    if (!userId) return;
    setOxaLoading(true);
    setOxaError('');
    try {
      const res = await apiFetch<{ address: string; oxaNetwork?: string }>('/api/oxapay/static-address', {
        method: 'POST',
        body: JSON.stringify({ userId, email: userEmail || '', network: net, currency: asset }),
      });
      if (res?.address) {
        setOxaAddresses((prev) => ({ ...prev, [net]: res.address }));
      }
    } catch (err) {
      setOxaError(err instanceof Error ? err.message : 'No se pudo obtener dirección OxaPay');
    } finally {
      setOxaLoading(false);
    }
  }

  useEffect(() => {
    if (env === 'REAL' && userId && !oxaAddresses[selectedNetwork] && !oxaLoading) {
      fetchOxaStaticAddress(selectedNetwork, selectedAsset);
    }
  }, [env, selectedNetwork, selectedAsset, userId]);

  function copyAddress() {
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleResetDemo() {
    setFeedback(null);
    try {
      const res = await apiFetch<{ initialUsdt: number }>('/api/wallet/demo/reset', { method: 'POST' });
      setFeedback({ type: 'ok', text: `Cuenta DEMO restablecida a ${formatCurrency(res.initialUsdt, 0)} USDT virtuales.` });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al restablecer DEMO' });
    }
  }

  async function handleTopupDemo() {
    setFeedback(null);
    try {
      await apiFetch('/api/wallet/demo/topup', { method: 'POST', body: JSON.stringify({ amount: 2500 }) });
      setFeedback({ type: 'ok', text: '+2,500 USDT virtuales acreditados en DEMO.' });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al recargar DEMO' });
    }
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch<{ status: string; message?: string; txid?: string }>('/api/wallet/deposit', {
        method: 'POST',
        body: JSON.stringify({
          env,
          asset: selectedAsset,
          network: selectedNetwork,
          amount: parseFloat(depositAmount) || 0,
          txid: depositTxid,
        }),
      });
      setFeedback({
        type: 'ok',
        text: res.message || `Depósito ${res.status} en ${env} · TXID: ${res.txid}`,
      });
      setDepositTxid('');
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error procesando depósito' });
    }
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch<{ status: string }>('/api/wallet/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          env,
          asset: selectedAsset,
          network: selectedNetwork,
          address: withdrawAddr,
          amount: parseFloat(withdrawAmt) || 0,
          twoFactorCode: withdraw2fa,
        }),
      });
      setFeedback({ type: 'ok', text: `Solicitud de retiro registrada (${res.status}).` });
      setWithdrawAmt('');
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error solicitando retiro' });
    }
  }

  async function handleAddWhitelist(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/wallet/whitelist', {
        method: 'POST',
        body: JSON.stringify({ asset: selectedAsset, network: selectedNetwork, address: wlAddr, label: wlLabel }),
      });
      setFeedback({ type: 'ok', text: 'Dirección agregada a la lista blanca de retiros.' });
      setWlLabel('');
      setWlAddr('');
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error agregando dirección' });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Billetera & Sistema Financiero ({env})</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Separación contable estricta entre fondos virtuales DEMO y fondos reales. Sin transferencias entre entornos.
          </p>
        </div>

        {env === 'DEMO' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTopupDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/15 px-3.5 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/25 cursor-pointer"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Recargar +2,500 DEMO</span>
            </button>
            <button
              type="button"
              onClick={handleResetDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>RESTABLECER DEMO</span>
            </button>
          </div>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Balance Total ({env})</div>
          <div className="font-mono text-2xl font-bold text-white mt-1 tabular-nums">${formatCurrency(summary.totalUsdt)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Disponible</div>
          <div className="font-mono text-2xl font-bold text-emerald-400 mt-1 tabular-nums">${formatCurrency(summary.availableUsdt)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111520] p-4">
          <div className="text-xs text-slate-400">Bloqueado en Órdenes / Margen</div>
          <div className="font-mono text-2xl font-bold text-amber-400 mt-1 tabular-nums">${formatCurrency(summary.lockedUsdt)}</div>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#111520] border border-white/10 w-fit">
        {[
          { id: 'balances', label: 'Activos' },
          { id: 'deposit', label: 'Depositar' },
          { id: 'withdraw', label: 'Retirar' },
          { id: 'whitelist', label: 'Lista Blanca' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setActiveTab(t.id as typeof activeTab);
              setFeedback(null);
            }}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
              activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          className={`rounded-xl px-4 py-3 text-xs border ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {activeTab === 'balances' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
          <table className="w-full text-left text-xs min-w-160">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-3 px-4">Activo</th>
                <th className="py-3 px-4 text-right">Disponible</th>
                <th className="py-3 px-4 text-right">Bloqueado</th>
                <th className="py-3 px-4 text-right">Valor USDT</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono tabular-nums">
              {wallets.map((w) => (
                <tr key={w.asset} className="hover:bg-white/2">
                  <td className="py-3 px-4 font-sans font-bold text-white">{w.asset}</td>
                  <td className="py-3 px-4 text-right text-slate-200">{w.available.toFixed(4)}</td>
                  <td className="py-3 px-4 text-right text-slate-400">{w.locked.toFixed(4)}</td>
                  <td className="py-3 px-4 text-right text-white font-semibold">${formatCurrency(w.usdValue)}</td>
                  <td className="py-3 px-4 text-right font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAsset(w.asset);
                        setActiveTab('deposit');
                      }}
                      className="text-blue-400 hover:underline mr-3 cursor-pointer"
                    >
                      Depositar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAsset(w.asset);
                        setActiveTab('withdraw');
                      }}
                      className="text-slate-300 hover:underline cursor-pointer"
                    >
                      Retirar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'deposit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-white">Dirección de Depósito Multi-Red ({env})</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Criptomoneda</label>
                <select
                  value={selectedAsset}
                  onChange={(e) => setSelectedAsset(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs font-semibold text-white"
                >
                  {['USDT', 'BTC', 'ETH', 'SOL', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE'].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Red Compatible</label>
                <select
                  value={selectedNetwork}
                  onChange={(e) => setSelectedNetwork(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs font-semibold text-white"
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-amber-500/20 bg-[#090B10] p-4">
              {depositAddress ? (
                <QrMatrix value={depositAddress} size={132} />
              ) : (
                <div className="h-33 w-33 rounded-lg border border-white/10 bg-[#111520] flex items-center justify-center text-center p-2 text-[10px] text-slate-400 shrink-0">
                  {oxaLoading ? 'Conectando OxaPay...' : 'Sin dirección real aún'}
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-slate-400">Dirección asignada ({selectedNetwork})</div>
                  {env === 'REAL' && oxaAddressForNet && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-400/35 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      <Sparkles className="h-3 w-3" />
                      OxaPay Única · Auto-Acreditación
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-white break-all">
                  {oxaLoading
                    ? 'Cargando tu dirección permanente de depósito...'
                    : depositAddress || 'Dirección de depósito en aprovisionamiento...'}
                </div>
                {oxaError && env === 'REAL' && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
                    {oxaError}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {depositAddress && (
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 cursor-pointer"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copied ? 'Copiado' : 'Copiar Dirección'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleDeposit} className="lg:col-span-6 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-white">
              {env === 'DEMO' ? 'Simular Depósito en Entorno DEMO' : 'Registrar TXID para Verificación Blockchain'}
            </h2>
            <p className="text-xs text-slate-400">
              Nunca se acreditan depósitos mediante capturas o comprobantes manuales sin conciliación de hash TXID.
            </p>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Monto ({selectedAsset})</label>
              <input
                type="number"
                step="any"
                required
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Hash TXID {env === 'DEMO' ? '(opcional en DEMO)' : '(obligatorio en REAL)'}
              </label>
              <input
                type="text"
                required={env === 'REAL'}
                value={depositTxid}
                onChange={(e) => setDepositTxid(e.target.value)}
                placeholder="0x..."
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
            >
              {env === 'DEMO' ? 'Acreditar en Billetera DEMO' : 'Enviar TXID a Conciliación'}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'withdraw' && (
        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 max-w-xl space-y-4">
          {env === 'DEMO' ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-amber-200">
              <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
              <div className="space-y-1">
                <div className="font-semibold">Retiros deshabilitados en MODO DEMO</div>
                <p>
                  El saldo DEMO es dinero virtual exclusivamente para práctica y competencias. No tiene valor monetario
                  real ni puede transferirse a cuentas REALES o wallets externas.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleWithdraw} className="space-y-3">
              <h2 className="font-display text-base font-bold text-white">Solicitud de Retiro (REAL)</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Activo</label>
                  <select
                    value={selectedAsset}
                    onChange={(e) => setSelectedAsset(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
                  >
                    {wallets.map((w) => (
                      <option key={w.asset} value={w.asset}>
                        {w.asset}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Red</label>
                  <select
                    value={selectedNetwork}
                    onChange={(e) => setSelectedNetwork(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
                  >
                    {NETWORKS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Dirección Destino</label>
                <input
                  type="text"
                  required
                  value={withdrawAddr}
                  onChange={(e) => setWithdrawAddr(e.target.value)}
                  placeholder="Dirección de retiro verificada"
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Monto</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Código 2FA (si está activo)</label>
                <input
                  type="text"
                  value={withdraw2fa}
                  onChange={(e) => setWithdraw2fa(e.target.value)}
                  placeholder="6 dígitos"
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
              >
                Enviar Solicitud de Retiro
              </button>
            </form>
          )}
        </div>
      )}

      {activeTab === 'whitelist' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form onSubmit={handleAddWhitelist} className="lg:col-span-5 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-white">Agregar Dirección a Lista Blanca</h2>
            <input
              type="text"
              required
              value={wlLabel}
              onChange={(e) => setWlLabel(e.target.value)}
              placeholder="Etiqueta (ej. Ledger Arbitrum)"
              className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
            />
            <input
              type="text"
              required
              value={wlAddr}
              onChange={(e) => setWlAddr(e.target.value)}
              placeholder="Dirección pública"
              className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white"
            />
            <button type="submit" className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white cursor-pointer">
              Guardar en Lista Blanca
            </button>
          </form>

          <div className="lg:col-span-7 rounded-xl border border-white/10 bg-[#111520] p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Direcciones Autorizadas ({whitelist.length})</h3>
            {whitelist.length === 0 ? (
              <p className="text-xs text-slate-400">No has guardado direcciones en tu lista blanca todavía.</p>
            ) : (
              <div className="divide-y divide-white/6 text-xs">
                {whitelist.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-white">
                        {item.label} · {item.asset} ({item.network})
                      </div>
                      <div className="font-mono text-slate-400">{item.address}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Historial Financiero ({env})</h3>
          <span className="text-xs text-slate-500">{transactions.length} movimientos</span>
        </div>
        {transactions.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">Sin movimientos registrados en {env}.</div>
        ) : (
          <table className="w-full text-left text-xs min-w-170">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-2.5 px-4">Tipo</th>
                <th className="py-2.5 px-4">Activo / Red</th>
                <th className="py-2.5 px-4 text-right">Monto</th>
                <th className="py-2.5 px-4">TXID</th>
                <th className="py-2.5 px-4">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono tabular-nums">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-2.5 px-4 font-sans font-semibold text-white">{tx.type}</td>
                  <td className="py-2.5 px-4 font-sans text-slate-300">
                    {tx.asset} · {tx.network}
                  </td>
                  <td className="py-2.5 px-4 text-right text-white">{tx.amount}</td>
                  <td className="py-2.5 px-4 text-slate-400 truncate max-w-45">{tx.txid}</td>
                  <td className="py-2.5 px-4 font-sans">
                    <span
                      className={
                        tx.status === 'CONFIRMED'
                          ? 'text-emerald-400 font-semibold'
                          : tx.status === 'PENDING'
                          ? 'text-amber-400 font-semibold'
                          : 'text-red-400 font-semibold'
                      }
                    >
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
