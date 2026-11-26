import { useEffect, useState } from 'react';
import { Send, Pin, Flag, Trash2, Users, Trophy, BookOpen, Copy, Check, ExternalLink, Sparkles, Gift } from 'lucide-react';
import { apiFetch, formatCurrency, resolveIpfsUrl } from '../api';
import { AdminMissionTask, ChatMessage, MissionClaim, UserProfile } from '../types';

interface Props {
  mode: 'community' | 'referrals' | 'competitions' | 'academy';
  user: UserProfile;
  wsLatestChat: ChatMessage | null;
}

const ROOMS = [
  { id: 'general', label: 'Chat General' },
  { id: 'bitcoin', label: 'Bitcoin' },
  { id: 'altcoins', label: 'Altcoins' },
  { id: 'futures', label: 'Futuros' },
  { id: 'bots', label: 'Bots IA' },
  { id: 'signals', label: 'Señales' },
  { id: 'community', label: 'Comunidad' },
];

const ACADEMY_MODULES = [
  {
    title: '1. Comprar y Vender en Spot',
    summary: 'Aprende la diferencia entre órdenes Market (ejecución inmediata) y Limit (precio elegido por ti).',
    steps: [
      'Selecciona el par deseado (ej. BTC/USDT).',
      'En Modo Sencillo elige Comprar o Vender e introduce el importe.',
      'En Modo Profesional añade Stop Loss y Take Profit para proteger tu capital.',
    ],
  },
  {
    title: '2. Crear y Proteger tu Wallet',
    summary: 'Usa direcciones por red compatible (Arbitrum, Solana, Bitcoin, Tron) y activa 2FA.',
    steps: [
      'Elige siempre la misma red en el origen y en el destino antes de depositar.',
      'Guarda tus direcciones frecuentes en la Lista Blanca de retiros.',
      'En MODO DEMO puedes practicar depósitos y restablecer saldo virtual ilimitadamente.',
    ],
  },
  {
    title: '3. Usar Bots de Trading IA',
    summary: 'Automatiza estrategias de Scalping, Grid, DCA, Trend Following y AI Predictive en DEMO.',
    steps: [
      'Compara riesgo y porcentaje de aciertos simulados vs backtest histórico.',
      'Asigna un capital limitado en DEMO y observa al menos 20 operaciones antes de ajustar.',
      'Pausa o detén cualquier bot en 1 clic si cambian las condiciones de volatilidad.',
    ],
  },
  {
    title: '4. Entender Señales e Inteligencia IA',
    summary: 'Cómo leer probabilidades alcistas/bajistas/laterales y ratios riesgo-beneficio.',
    steps: [
      'Toda señal incluye Entrada sugerida, Stop Loss obligatorio y Take Profit.',
      'Verifica si la lectura proviene de indicadores reales (RSI, EMA, MACD) y qué riesgos existen.',
    ],
  },
  {
    title: '5. Futuros, Apalancamiento y Liquidaciones',
    summary: 'Comprende cómo el apalancamiento (2x hasta 125x) acerca tu precio de liquidación.',
    steps: [
      'Con 10x, una caída del ~9.5% en contra liquida una posición LONG aislada.',
      'Usa siempre Isolated Margin y Stop Loss cuando estés aprendiendo.',
      'Utiliza la Calculadora de Posición antes de confirmar.',
    ],
  },
  {
    title: '6. Token Factory y Tokenomics',
    summary: 'Cómo se estructuran suministros, calendarios de vesting, liquidez y auditorías de contratos.',
    steps: [
      'Revisa la distribución entre liquidez, comunidad y reservas antes de operar un token nuevo.',
      'Los tokens propios siempre se prueban en testnet antes de habilitar mercados.',
    ],
  },
];

export function CommunityAndGrowthView({ mode, user, wsLatestChat }: Props) {
  const [room, setRoom] = useState('general');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [referralsData, setReferralsData] = useState<{
    referralCode: string;
    referrals: Array<{ id: string; referred_email: string; reward_usdt: number; status: string; created_at: number }>;
    settings: { inviteRewardUsdt?: number; commissionPct?: number };
  } | null>(null);
  const [compData, setCompData] = useState<{
    competitions: Array<{ id: string; title: string; description: string; period: string; virtual_capital: number; prize_pool_desc: string }>;
    leaderboard: Array<{ userId: string; name: string; equityUsdt: number; roiPct: number; ordersCount: number }>;
  } | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [missions, setMissions] = useState<AdminMissionTask[]>([]);
  const [claims, setClaims] = useState<MissionClaim[]>([]);
  const [proofInputs, setProofInputs] = useState<Record<string, string>>({});
  const [missionMsg, setMissionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const isMod = ['MODERATOR', 'ADMIN', 'SUPERADMIN'].includes(user.role);

  async function loadMissions() {
    try {
      const res = await apiFetch<{ missions: AdminMissionTask[]; claims: MissionClaim[] }>('/api/missions');
      if (Array.isArray(res?.missions)) setMissions(res.missions);
      if (Array.isArray(res?.claims)) setClaims(res.claims);
    } catch {
      // ignore
    }
  }

  async function loadRoom(r: string) {
    try {
      const res = await apiFetch<{ messages: ChatMessage[] }>(`/api/community/messages?room=${r}`);
      setMessages(res.messages);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (mode === 'community') loadRoom(room);
    if (mode === 'referrals') {
      apiFetch<typeof referralsData>('/api/referrals').then(setReferralsData).catch(() => { });
      loadMissions();
    }
    if (mode === 'competitions') {
      apiFetch<typeof compData>('/api/competitions').then(setCompData).catch(() => { });
    }
  }, [mode, room]);

  useEffect(() => {
    if (wsLatestChat && wsLatestChat.room === room) {
      setMessages((prev) => (prev.some((m) => m.id === wsLatestChat.id) ? prev : [...prev, wsLatestChat]));
    }
  }, [wsLatestChat, room]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await apiFetch('/api/community/messages', {
        method: 'POST',
        body: JSON.stringify({ room, content: text }),
      });
      setText('');
      loadRoom(room);
    } catch {
      // ignore
    }
  }

  async function handlePin(id: string) {
    await apiFetch(`/api/community/messages/${id}/pin`, { method: 'POST' });
    loadRoom(room);
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/community/messages/${id}`, { method: 'DELETE' });
    loadRoom(room);
  }

  async function handleReport(id: string) {
    await apiFetch(`/api/community/messages/${id}/report`, { method: 'POST' });
  }

  if (mode === 'academy') {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Asistente de Aprendizaje — Academia Cripto</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Guías claras y prácticas para dominar Spot, Wallet, Bots IA, Señales, Futuros y Token Factory.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ACADEMY_MODULES.map((m) => (
            <div key={m.title} className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
              <div className="flex items-center gap-2 text-blue-400 font-display text-base font-bold">
                <BookOpen className="h-4 w-4 shrink-0" />
                <span>{m.title}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{m.summary}</p>
              <ul className="space-y-1.5 text-xs text-slate-400 list-disc pl-4">
                {m.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'referrals') {
    const inviteLink = `${window.location.origin}/?ref=${referralsData?.referralCode || user.referral_code}`;
    return (
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Programa de Referidos y Recompensas</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Recompensas transparentes por actividad elegible verificada. Reglas estrictas antifraude; sin estructuras piramidales.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div className="md:col-span-2 space-y-2">
            <div className="text-xs text-slate-400">Tu Enlace de Invitación Personal</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-[#090B10] border border-white/10 px-3 py-2 text-xs font-mono text-blue-300 break-all">
                {inviteLink}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink);
                  setCopiedRef(true);
                  setTimeout(() => setCopiedRef(false), 1800);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                {copiedRef ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedRef ? 'Copiado' : 'Copiar Enlace'}</span>
              </button>
            </div>
          </div>
          <div className="rounded-lg bg-[#090B10] border border-white/8 p-4 text-xs space-y-1">
            <div className="text-slate-400">Premio por invitación válida</div>
            <div className="font-mono text-lg font-bold text-emerald-400">
              ${referralsData?.settings?.inviteRewardUsdt ?? 25} USDT
            </div>
            <div className="text-slate-500">Comisión actividad: {referralsData?.settings?.commissionPct ?? 15}%</div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/25 bg-[#111520] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <span>Misiones, Redes Sociales & Premios en Cripto</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Visita nuestras redes oficiales (TG, YT, X, IG) o crea contenido (TikTok/YouTube) con tu código{' '}
                <span className="font-mono text-cyan-300 font-bold">{user.referral_code}</span> y gana USDT.
              </p>
            </div>
          </div>

          {missionMsg && (
            <div
              className={`rounded-lg border px-3.5 py-2.5 text-xs ${missionMsg.type === 'ok'
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/35 bg-red-500/10 text-red-300'
                }`}
            >
              {missionMsg.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {missions.map((m) => {
              const claim = claims.find((c) => c.missionId === m.id);
              return (
                <div
                  key={m.id}
                  className="rounded-2xl border border-white/10 bg-[#090B10] overflow-hidden flex flex-col justify-between shadow-lg"
                >
                  {m.bannerImageUrl && (
                    <div className="relative h-28 overflow-hidden">
                      <img
                        src={resolveIpfsUrl(m.bannerImageUrl)}
                        alt={m.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-linear-to-t from-[#090B10] via-[#090B10]/45 to-transparent" />
                      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                        <span className="rounded-full bg-black/75 border border-cyan-400/40 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          {m.platform}
                        </span>
                        <span className="rounded-full bg-emerald-500/25 border border-emerald-400/50 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                          +${m.rewardUsdt} {m.rewardAsset}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-display text-sm font-bold text-white">{m.title}</h3>
                      <p className="text-[11px] text-slate-400 mt-1">{m.description}</p>
                    </div>

                    {claim ? (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 flex items-center gap-2">
                        <Check className="h-4 w-4" />
                        <span>
                          {claim.status === 'COMPLETED'
                            ? `Premio +$${claim.rewardUsdt} USDT acreditado`
                            : 'Prueba enviada · En revisión por el equipo'}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {m.requiresProof && (
                          <input
                            type="url"
                            value={proofInputs[m.id] || ''}
                            onChange={(e) => setProofInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                            placeholder="Pega el enlace de tu TikTok / video con tu referido..."
                            className="w-full rounded-lg border border-white/10 bg-[#111520] px-3 py-1.5 text-xs text-white"
                          />
                        )}
                        <div className="flex items-center gap-2">
                          {m.actionUrl && (
                            <a
                              href={m.actionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200"
                            >
                              <span>Ir a {m.platform}</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              setMissionMsg(null);
                              try {
                                const res = await apiFetch<{ claim: MissionClaim }>('/api/missions/claim', {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    missionId: m.id,
                                    proofUrl: proofInputs[m.id] || '',
                                  }),
                                });
                                setMissionMsg({
                                  type: 'ok',
                                  text:
                                    res.claim.status === 'COMPLETED'
                                      ? `¡Misión completada! +$${m.rewardUsdt} ${m.rewardAsset} acreditados.`
                                      : '¡Prueba enviada! Nuestro equipo verificará tu enlace y acreditará tu premio.',
                                });
                                loadMissions();
                              } catch (err) {
                                setMissionMsg({
                                  type: 'err',
                                  text: err instanceof Error ? err.message : 'Error reclamando misión',
                                });
                              }
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-linear-to-r from-amber-500 to-cyan-500 py-2 px-3 text-xs font-bold text-slate-950 hover:brightness-110 cursor-pointer"
                          >
                            <Gift className="h-3.5 w-3.5" />
                            <span>{m.requiresProof ? 'Enviar Prueba y Reclamar' : 'Reclamar Premio'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Invitados Registrados ({referralsData?.referrals.length || 0})</h2>
          {!referralsData || referralsData.referrals.length === 0 ? (
            <p className="text-xs text-slate-400">Aún no tienes usuarios referidos. Comparte tu código {user.referral_code}.</p>
          ) : (
            <div className="divide-y divide-white/6 text-xs">
              {referralsData.referrals.map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between">
                  <span className="text-white">{r.referred_email}</span>
                  <span className="font-mono text-emerald-400">+${r.reward_usdt} USDT ({r.status})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'competitions') {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Competencias y Torneos DEMO</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Todos los participantes inician con el mismo capital virtual DEMO. Premios virtuales separados de fondos reales.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {compData?.competitions.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                  <Trophy className="h-4 w-4" /> Torneo {c.period}
                </span>
                <span className="font-mono text-xs text-slate-400">Capital: ${formatCurrency(c.virtual_capital, 0)} DEMO</span>
              </div>
              <h2 className="font-display text-base font-bold text-white">{c.title}</h2>
              <p className="text-xs text-slate-400">{c.description}</p>
              <div className="text-xs text-emerald-400 font-semibold pt-1">Premio: {c.prize_pool_desc}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
          <div className="px-4 py-3 border-b border-white/8 text-sm font-semibold text-white">
            Ranking en Tiempo Real (Rentabilidad DEMO)
          </div>
          <table className="w-full text-left text-xs min-w-[540px]">
            <thead>
              <tr className="border-b border-white/8 text-[11px] text-slate-400">
                <th className="py-2.5 px-4">Posición</th>
                <th className="py-2.5 px-4">Trader</th>
                <th className="py-2.5 px-4 text-right">Equidad DEMO</th>
                <th className="py-2.5 px-4 text-right">Órdenes</th>
                <th className="py-2.5 px-4 text-right">ROI %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 font-mono tabular-nums">
              {compData?.leaderboard.map((row, idx) => (
                <tr key={row.userId}>
                  <td className="py-2.5 px-4 text-amber-400 font-bold">#{idx + 1}</td>
                  <td className="py-2.5 px-4 font-sans font-semibold text-white">{row.name}</td>
                  <td className="py-2.5 px-4 text-right text-slate-200">${formatCurrency(row.equityUsdt)}</td>
                  <td className="py-2.5 px-4 text-right text-slate-400">{row.ordersCount}</td>
                  <td className={`py-2.5 px-4 text-right font-semibold ${row.roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.roiPct >= 0 ? '+' : ''}
                    {row.roiPct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* LIVE COMMUNITY CHAT */
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-180px)] min-h-[520px]">
      <div className="lg:col-span-3 rounded-xl border border-white/10 bg-[#111520] p-3 space-y-1">
        <div className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-slate-300 border-b border-white/8 mb-2">
          <Users className="h-4 w-4 text-blue-400" />
          <span>Salas de Comunidad</span>
        </div>
        <div className="flex lg:flex-col gap-1 overflow-x-auto">
          {ROOMS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoom(r.id)}
              className={`px-3 py-2 rounded-lg text-xs font-medium text-left whitespace-nowrap cursor-pointer ${room === r.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-9 rounded-xl border border-white/10 bg-[#111520] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <div className="text-sm font-bold text-white">{ROOMS.find((r) => r.id === room)?.label}</div>
          <span className="text-xs text-slate-400">WebSocket en vivo</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg p-3 text-xs border ${m.pinned ? 'border-blue-500/35 bg-blue-500/10' : 'border-white/6 bg-[#090B10]'
                }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{m.author_name}</span>
                  {m.author_role !== 'USER' && (
                    <span className="text-[10px] font-semibold text-violet-400">{m.author_role}</span>
                  )}
                  {m.pinned === 1 && <span className="text-[10px] text-blue-300 font-semibold">Fijado</span>}
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                  <button type="button" onClick={() => handleReport(m.id)} title="Reportar" className="hover:text-amber-400 cursor-pointer">
                    <Flag className="h-3.5 w-3.5" />
                  </button>
                  {isMod && (
                    <>
                      <button type="button" onClick={() => handlePin(m.id)} title="Fijar" className="hover:text-blue-400 cursor-pointer">
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => handleDelete(m.id)} title="Eliminar" className="hover:text-red-400 cursor-pointer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="text-slate-200 leading-relaxed">{m.content}</p>
            </div>
          ))}
        </div>

        <form onSubmit={handleSend} className="p-3 border-t border-white/8 flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe un mensaje, idea o análisis de mercado..."
            className="flex-1 rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Enviar</span>
          </button>
        </form>
      </div>
    </div>
  );
}
