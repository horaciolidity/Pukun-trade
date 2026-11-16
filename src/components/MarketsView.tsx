import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import { formatCurrency, formatPrice } from '../api';
import { Market, NavSection } from '../types';

interface Props {
  markets: Market[];
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  onSelectTrade: (tab: NavSection, symbol: string) => void;
}

export function MarketsView({ markets, favorites, onToggleFavorite, onSelectTrade }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'FAVORITES' | 'FUTURES' | 'CUSTOM'>('ALL');

  const filtered = markets.filter((m) => {
    const matchesSearch = m.symbol.toLowerCase().includes(query.toLowerCase()) || m.base.toLowerCase().includes(query.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'FAVORITES') return favorites.includes(m.symbol);
    if (filter === 'FUTURES') return m.futures_enabled === 1;
    if (filter === 'CUSTOM') return m.is_custom_token === 1;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Mercados de Criptomonedas</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Cotizaciones en tiempo real, liquidez y acceso directo a Spot, Futuros y Quick Trading.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar BTC, SOL, CAIX..."
              className="rounded-lg border border-white/10 bg-[#111520] pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#111520] border border-white/10">
            {[
              { id: 'ALL', label: 'Todos' },
              { id: 'FAVORITES', label: 'Favoritos' },
              { id: 'FUTURES', label: 'Futuros' },
              { id: 'CUSTOM', label: 'Tokens Propios' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id as typeof filter)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  filter === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111520] overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-white/8 text-[11px] font-medium text-slate-400">
              <th className="py-3 px-4">Par</th>
              <th className="py-3 px-4 text-right">Último Precio</th>
              <th className="py-3 px-4 text-right">Cambio 24h</th>
              <th className="py-3 px-4 text-right">Máx / Mín 24h</th>
              <th className="py-3 px-4 text-right">Volumen 24h</th>
              <th className="py-3 px-4 text-right">Apalancamiento</th>
              <th className="py-3 px-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6 text-xs">
            {filtered.map((m) => (
              <tr key={m.symbol} className="hover:bg-white/[0.02]">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(m.symbol)}
                      className="cursor-pointer"
                      aria-label={`Favorito ${m.symbol}`}
                    >
                      <Star className={`h-4 w-4 ${favorites.includes(m.symbol) ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />
                    </button>
                    <div>
                      <div className="font-semibold text-white">{m.symbol}</div>
                      <div className="text-[11px] text-slate-500">
                        {m.is_custom_token ? 'Token Propio' : m.price_source === 'BINANCE_PUBLIC' ? 'Cotización Pública' : 'Feed Mercado'}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-mono font-semibold text-white tabular-nums">
                  ${formatPrice(m.last_price)}
                </td>
                <td className={`py-3 px-4 text-right font-mono font-semibold tabular-nums ${m.change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {m.change_24h >= 0 ? '+' : ''}
                  {m.change_24h.toFixed(2)}%
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                  ${formatPrice(m.high_24h)} / ${formatPrice(m.low_24h)}
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                  ${formatCurrency(m.volume_24h / 1000000, 2)}M
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                  {m.futures_enabled ? `Hasta ${m.max_leverage}x` : 'Solo Spot'}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectTrade('spot', m.symbol)}
                      className="rounded-md bg-blue-600/20 border border-blue-500/30 px-2.5 py-1 text-xs font-medium text-blue-300 hover:bg-blue-600/30 cursor-pointer"
                    >
                      Spot
                    </button>
                    {m.futures_enabled === 1 && (
                      <button
                        type="button"
                        onClick={() => onSelectTrade('futures', m.symbol)}
                        className="rounded-md bg-violet-600/20 border border-violet-500/30 px-2.5 py-1 text-xs font-medium text-violet-300 hover:bg-violet-600/30 cursor-pointer"
                      >
                        Futuros
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectTrade('quick-trade', m.symbol)}
                      className="rounded-md bg-emerald-600/20 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-600/30 cursor-pointer"
                    >
                      Quick
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
