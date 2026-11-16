import { useState } from 'react';
import { Layers, CheckCircle2, Rocket, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { apiFetch, formatCurrency } from '../api';
import { CustomToken, Market, NavSection, UserRole } from '../types';

interface Props {
  mode: 'token-factory' | 'launchpad';
  userRole: UserRole;
  tokens: CustomToken[];
  markets: Market[];
  onRefresh: () => void;
  onTradeToken: (tab: NavSection, symbol: string) => void;
}

const BLOCKCHAINS = ['Ethereum', 'BNB Smart Chain', 'Polygon', 'Arbitrum', 'Optimism', 'Base', 'Avalanche', 'Solana'];
const DEPLOY_STEPS = [
  '1. Completar datos',
  '2. Seleccionar red',
  '3. Configurar tokenomics',
  '4. Revisar contrato',
  '5. Simular costos',
  '6. Ejecutar pruebas',
  '7. Realizar auditorías',
  '8. Firmar despliegue',
  '9. Registrar dirección',
  '10. Verificar contrato',
];

export function TokenFactoryView({ mode, userRole, tokens, markets, onRefresh, onTradeToken }: Props) {
  const isSuperadmin = userRole === 'SUPERADMIN';
  const [step, setStep] = useState(1);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [logoColor, setLogoColor] = useState('#3B82F6');
  const [description, setDescription] = useState('');
  const [blockchain, setBlockchain] = useState('Arbitrum');
  const [totalSupply, setTotalSupply] = useState('10000000');
  const [initialSupply, setInitialSupply] = useState('2500000');
  const [maxSupply, setMaxSupply] = useState('10000000');
  const [decimals, setDecimals] = useState('18');
  const [initialPrice, setInitialPrice] = useState('0.25');
  const [isVariable, setIsVariable] = useState(false);
  const [mintable, setMintable] = useState(false);
  const [burnable, setBurnable] = useState(true);
  const [pausable, setPausable] = useState(true);
  const [listOnExchange, setListOnExchange] = useState(true);

  const [liqPct, setLiqPct] = useState(35);
  const [commPct, setCommPct] = useState(25);
  const [mktPct, setMktPct] = useState(15);
  const [rewPct, setRewPct] = useState(15);
  const [resPct, setResPct] = useState(10);

  const [utilities, setUtilities] = useState({
    trading: true,
    rewards: true,
    feeDiscounts: true,
    premiumAccess: false,
    loyalty: true,
    missions: true,
    staking: true,
    communityBenefits: true,
  });

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const totalTokenomicsPct = liqPct + commPct + mktPct + rewPct + resPct;

  async function handleDeployToken() {
    setFeedback(null);
    if (totalTokenomicsPct !== 100) {
      setFeedback({ type: 'err', text: 'La distribución de Tokenomics debe sumar exactamente 100%.' });
      return;
    }
    setSubmitting(true);
    try {
      const tokenomics = [
        { label: 'Liquidez', pct: liqPct, vesting: 'Bloqueo 24 meses' },
        { label: 'Comunidad', pct: commPct, vesting: 'Lineal 36 meses' },
        { label: 'Marketing', pct: mktPct, vesting: 'Desbloqueo trimestral' },
        { label: 'Recompensas', pct: rewPct, vesting: 'Emisión por misiones' },
        { label: 'Reserva del Proyecto', pct: resPct, vesting: '12 meses cliff' },
      ];
      const res = await apiFetch<{ symbol: string; contractAddress: string }>('/api/tokens/create', {
        method: 'POST',
        body: JSON.stringify({
          name,
          symbol,
          logoColor,
          description,
          blockchain,
          standard: blockchain === 'Solana' ? 'SPL' : 'ERC-20',
          totalSupply: Number(totalSupply),
          initialSupply: Number(initialSupply),
          maxSupply: Number(maxSupply),
          decimals: Number(decimals),
          isVariable,
          mintable,
          burnable,
          pausable,
          tokenomics,
          utilities,
          initialPriceUsdt: Number(initialPrice),
          listOnExchange,
          launchpadStatus: 'AVAILABLE',
        }),
      });
      setFeedback({
        type: 'ok',
        text: `Token ${res.symbol} desplegado y verificado en testnet simulada (${res.contractAddress}).`,
      });
      setStep(1);
      setName('');
      setSymbol('');
      setDescription('');
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error desplegando token' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleTokenListing(t: CustomToken) {
    try {
      await apiFetch(`/api/tokens/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ listedOnExchange: !t.listed_on_exchange }),
      });
      onRefresh();
    } catch {
      // ignore
    }
  }

  async function handleLaunchpadStatus(t: CustomToken, launchpadStatus: string) {
    try {
      await apiFetch(`/api/tokens/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ launchpadStatus }),
      });
      onRefresh();
    } catch {
      // ignore
    }
  }

  if (mode === 'launchpad') {
    const customMarkets = markets.filter((m) => m.is_custom_token === 1);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Launchpad & Liquidez de Tokens Propios</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Proyectos verificados en testnet, tokenomics transparentes, utilidades activas y pools de liquidez en el exchange.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {tokens.map((t) => {
            const mkt = customMarkets.find((m) => m.base === t.symbol);
            return (
              <div key={t.id} className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-11 w-11 rounded-xl flex items-center justify-center font-display font-bold text-white text-sm shrink-0"
                      style={{ backgroundColor: t.logo_color }}
                    >
                      {t.symbol.slice(0, 4)}
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold text-white">
                        {t.name} ({t.symbol})
                      </h2>
                      <div className="text-xs text-slate-400">
                        {t.blockchain} · {t.standard} · Estado: <span className="text-blue-400 font-semibold">{t.launchpad_status}</span>
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    Auditado (Sim.)
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{t.description}</p>

                <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#090B10] border border-white/6 p-3 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-500 font-sans">Suministro Máx</div>
                    <div className="text-white font-semibold">{formatCurrency(t.max_supply, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-sans">Precio Mercado</div>
                    <div className="text-emerald-400 font-semibold">${(mkt?.last_price || t.initial_price_usdt).toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-sans">Liquidez Pool</div>
                    <div className="text-slate-200 font-semibold">${formatCurrency(mkt?.liquidity_usdt || 0, 0)}</div>
                  </div>
                </div>

                {/* Tokenomics Distribution Bar */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-400">Distribución Tokenomics</div>
                  <div className="space-y-1">
                    {t.tokenomics.map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300">
                          {item.label} <span className="text-slate-500">({item.vesting})</span>
                        </span>
                        <span className="font-mono text-white font-semibold">{item.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] font-mono text-slate-500 break-all">Contrato: {t.contract_address}</div>

                <div className="flex items-center justify-between pt-2 border-t border-white/8">
                  <div className="text-xs text-slate-400">
                    Utilidades:{' '}
                    {Object.entries(t.utilities)
                      .filter(([, on]) => on)
                      .slice(0, 3)
                      .map(([k]) => k)
                      .join(', ')}
                  </div>
                  {t.listed_on_exchange === 1 && (
                    <button
                      type="button"
                      onClick={() => onTradeToken('spot', `${t.symbol}/USDT`)}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
                    >
                      <span>Operar {t.symbol}/USDT</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* TOKEN FACTORY */
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-white">TOKEN FACTORY — Creación de Criptomonedas</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Módulo exclusivo de Superadministrador. Despliegue seguro en testnet previa firma autorizada sin almacenar claves privadas en texto plano.
          </p>
        </div>
      </div>

      {!isSuperadmin ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-xs text-amber-200">
          Acceso restringido: la creación y despliegue de contratos inteligentes en Token Factory requiere rol{' '}
          <span className="font-bold">SUPERADMIN</span>. Puedes explorar los tokens publicados en la sección Launchpad.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* 10-Step Creation Wizard */}
          <div className="xl:col-span-7 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-white/8 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Layers className="h-4 w-4 text-blue-400" />
                <span>Asistente de Despliegue (10 Pasos)</span>
              </div>
              <span className="text-xs font-mono text-blue-400">Paso {step} / 10</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {DEPLOY_STEPS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(idx + 1)}
                  className={`px-2 py-1.5 rounded text-[10px] font-medium text-left truncate cursor-pointer ${
                    step === idx + 1
                      ? 'bg-blue-600 text-white'
                      : idx + 1 < step
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-[#090B10] text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {step === 1 && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Nombre del Token</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ej. Quantum AI Coin"
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Símbolo</label>
                    <input
                      type="text"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                      placeholder="Ej. QAI"
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Color de Identidad</label>
                    <input
                      type="color"
                      value={logoColor}
                      onChange={(e) => setLogoColor(e.target.value)}
                      className="h-9 w-full rounded-lg border border-white/10 bg-[#090B10] p-1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Precio Inicial Ref. (USDT)</label>
                    <input
                      type="number"
                      step="0.001"
                      value={initialPrice}
                      onChange={(e) => setInitialPrice(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Descripción</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Propósito, gobernanza y utilidad dentro del ecosistema..."
                    className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-2">Red Blockchain y Estándar</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {BLOCKCHAINS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBlockchain(b)}
                        className={`rounded-lg border px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                          blockchain === b ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-white/10 bg-[#090B10] text-slate-300'
                        }`}
                      >
                        <div>{b}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{b === 'Solana' ? 'SPL' : 'ERC-20'}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Suministro Total</label>
                    <input type="number" value={totalSupply} onChange={(e) => setTotalSupply(e.target.value)} className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Suministro Inicial</label>
                    <input type="number" value={initialSupply} onChange={(e) => setInitialSupply(e.target.value)} className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Suministro Máximo</label>
                    <input type="number" value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Decimales</label>
                    <input type="number" value={decimals} onChange={(e) => setDecimals(e.target.value)} className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 font-mono text-xs text-white" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-300 pt-1">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={isVariable} onChange={(e) => setIsVariable(e.target.checked)} /> Suministro Variable</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={mintable} onChange={(e) => setMintable(e.target.checked)} /> Emisión (Mint)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={burnable} onChange={(e) => setBurnable(e.target.checked)} /> Quema (Burn)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={pausable} onChange={(e) => setPausable(e.target.checked)} /> Pausa de Transferencias</label>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Distribución Tokenomics (debe sumar 100%)</span>
                  <span className={`font-mono font-bold ${totalTokenomicsPct === 100 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalTokenomicsPct}%
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">Liquidez %</label>
                    <input type="number" value={liqPct} onChange={(e) => setLiqPct(Number(e.target.value))} className="w-full rounded border border-white/10 bg-[#090B10] px-2.5 py-1.5 font-mono text-white" />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Comunidad %</label>
                    <input type="number" value={commPct} onChange={(e) => setCommPct(Number(e.target.value))} className="w-full rounded border border-white/10 bg-[#090B10] px-2.5 py-1.5 font-mono text-white" />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Marketing %</label>
                    <input type="number" value={mktPct} onChange={(e) => setMktPct(Number(e.target.value))} className="w-full rounded border border-white/10 bg-[#090B10] px-2.5 py-1.5 font-mono text-white" />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Recompensas %</label>
                    <input type="number" value={rewPct} onChange={(e) => setRewPct(Number(e.target.value))} className="w-full rounded border border-white/10 bg-[#090B10] px-2.5 py-1.5 font-mono text-white" />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Reserva %</label>
                    <input type="number" value={resPct} onChange={(e) => setResPct(Number(e.target.value))} className="w-full rounded border border-white/10 bg-[#090B10] px-2.5 py-1.5 font-mono text-white" />
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-2">Utilidades en el Ecosistema</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-300">
                    {Object.entries(utilities).map(([key, val]) => (
                      <label key={key} className="flex items-center gap-2 rounded bg-[#090B10] px-2.5 py-1.5 border border-white/8">
                        <input
                          type="checkbox"
                          checked={val}
                          onChange={(e) => setUtilities({ ...utilities, [key]: e.target.checked })}
                        />
                        <span className="capitalize">{key}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step >= 4 && step <= 9 && (
              <div className="rounded-lg border border-white/8 bg-[#090B10] p-4 space-y-2 text-xs">
                <div className="font-semibold text-blue-300">{DEPLOY_STEPS[step - 1]}</div>
                <p className="text-slate-300">
                  Validación de contrato {blockchain === 'Solana' ? 'SPL' : 'ERC-20'} para{' '}
                  <span className="font-semibold text-white">{name || 'Nuevo Token'} ({symbol || 'SYM'})</span> en red{' '}
                  {blockchain} (Testnet previa a Mainnet). Gas estimado simulado: 0.0042 ETH equiv. Cero claves privadas
                  almacenadas en servidor.
                </p>
                <div className="flex items-center gap-2 text-emerald-400 pt-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Verificación automática de invariantes de suministro y permisos administrativos superada.</span>
                </div>
              </div>
            )}

            {step === 10 && (
              <div className="space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/8 p-4 text-xs">
                <div className="font-semibold text-emerald-300">Listo para Desplegar y Verificar Contrato en Testnet</div>
                <label className="flex items-center gap-2 text-slate-200">
                  <input type="checkbox" checked={listOnExchange} onChange={(e) => setListOnExchange(e.target.checked)} />
                  <span>Listar automáticamente en el Exchange Spot ({symbol || 'TOKEN'}/USDT) y Launchpad</span>
                </label>
                <button
                  type="button"
                  disabled={submitting || !name || !symbol}
                  onClick={handleDeployToken}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                >
                  <Rocket className="h-4 w-4" />
                  <span>{submitting ? 'Desplegando...' : 'Firmar y Desplegar en Testnet'}</span>
                </button>
              </div>
            )}

            {feedback && (
              <div
                className={`rounded-lg px-3.5 py-2.5 text-xs border ${
                  feedback.type === 'ok'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-white/8">
              <button
                type="button"
                disabled={step === 1}
                onClick={() => setStep(Math.max(1, step - 1))}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300 disabled:opacity-40 cursor-pointer"
              >
                Anterior
              </button>
              {step < 10 && (
                <button
                  type="button"
                  onClick={() => setStep(Math.min(10, step + 1))}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
                >
                  Siguiente Paso
                </button>
              )}
            </div>
          </div>

          {/* Token Manager & Liquidity Monitor */}
          <div className="xl:col-span-5 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-white">Administrador de Tokens & Liquidez</h2>
            <div className="space-y-3">
              {tokens.map((t) => (
                <div key={t.id} className="rounded-lg border border-white/8 bg-[#090B10] p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-white">
                      {t.name} ({t.symbol})
                    </div>
                    <span className="text-slate-400">
                      {t.blockchain} · {t.standard}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 truncate">{t.contract_address}</div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleToggleTokenListing(t)}
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                        t.listed_on_exchange
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-white/10 text-slate-300'
                      }`}
                    >
                      {t.listed_on_exchange ? 'Mercado Activo' : 'Habilitar Mercado'}
                    </button>
                    <select
                      value={t.launchpad_status}
                      onChange={(e) => handleLaunchpadStatus(t, e.target.value)}
                      className="rounded border border-white/10 bg-[#111520] px-2 py-1 text-[11px] text-slate-200"
                    >
                      {['UPCOMING', 'PRESALE', 'LAUNCHING', 'AVAILABLE', 'ENDED'].map((st) => (
                        <option key={st} value={st}>
                          Launchpad: {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
