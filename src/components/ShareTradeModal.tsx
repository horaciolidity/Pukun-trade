import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Share2, Sparkles, X } from 'lucide-react';
import { formatPrice } from '../api';

export interface ShareTradePayload {
  symbol: string;
  direction: string;
  entryPrice: number;
  closePrice: number;
  profit: number;
  returnPct: number;
  amount: number;
  modeLabel?: string;
}

interface Props {
  trade: ShareTradePayload | null;
  referralCode: string;
  referralRewardUsdt?: number;
  onClose: () => void;
}

export function ShareTradeModal({ trade, referralCode, referralRewardUsdt = 40, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const shareLink = trade
    ? `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}&trade=${encodeURIComponent(
        trade.symbol
      )}&pnl=${encodeURIComponent(trade.profit.toFixed(2))}&roi=${encodeURIComponent(trade.returnPct.toFixed(1))}`
    : '';

  useEffect(() => {
    if (!trade || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 1200;
    const H = 675;
    canvas.width = W;
    canvas.height = H;

    const isWin = trade.profit >= 0;

    const drawCard = (logoImg?: HTMLImageElement) => {
      // Deep obsidian + twilight gradient background
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, '#07090f');
      bgGrad.addColorStop(0.55, '#111629');
      bgGrad.addColorStop(1, isWin ? '#082019' : '#260b10');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Subtle ancestral grid
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Glowing radial aura behind PnL
      const aura = ctx.createRadialGradient(W * 0.65, H * 0.45, 20, W * 0.65, H * 0.45, 360);
      aura.addColorStop(0, isWin ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)');
      aura.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, W, H);

      // Gold & Cyan top stepped border bar
      for (let x = 0; x < W; x += 36) {
        ctx.fillStyle = x % 72 === 0 ? '#f59e0b' : '#22d3ee';
        ctx.fillRect(x, 0, 24, 6);
      }

      // Outer subtle frame
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(26, 26, W - 52, H - 52);

      // Logo + Brand top-left
      if (logoImg) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(64, 58, 72, 72, 16);
        ctx.clip();
        ctx.drawImage(logoImg, 64, 58, 72, 72);
        ctx.restore();
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 36px Outfit, system-ui, sans-serif';
      ctx.fillText('PUKUN', 154, 96);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('TRADE', 286, 96);

      ctx.fillStyle = '#22d3ee';
      ctx.font = '600 15px Plus Jakarta Sans, system-ui, sans-serif';
      ctx.fillText('ANCESTRAL TECH · CRYPTO AI EXCHANGE', 154, 124);

      // Mode badge top-right
      ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
      ctx.beginPath();
      ctx.roundRect(W - 350, 62, 286, 44, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fcd34d';
      ctx.font = '700 17px Plus Jakarta Sans, system-ui, sans-serif';
      ctx.fillText(trade.modeLabel || 'QUICK TRADING PRO', W - 320, 90);

      // Symbol & Direction
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 54px Outfit, system-ui, sans-serif';
      ctx.fillText(trade.symbol, 64, 245);

      const dirColor = trade.direction === 'UP' || trade.direction === 'LONG' ? '#10b981' : '#ef4444';
      ctx.fillStyle = dirColor;
      ctx.font = '800 26px JetBrains Mono, monospace';
      ctx.fillText(`● ${trade.direction === 'UP' ? 'SUBE (UP)' : trade.direction === 'DOWN' ? 'BAJA (DOWN)' : trade.direction}`, 64, 290);

      // Entry / Close / Stake details
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 18px Plus Jakarta Sans, system-ui, sans-serif';
      ctx.fillText('PRECIO ENTRADA', 64, 365);
      ctx.fillText('PRECIO CIERRE', 300, 365);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 28px JetBrains Mono, monospace';
      ctx.fillText(`$${formatPrice(trade.entryPrice)}`, 64, 405);
      ctx.fillText(`$${formatPrice(trade.closePrice || trade.entryPrice)}`, 300, 405);

      // Huge PnL Box on Right
      const pnlText = `${isWin ? '+' : '-'}$${Math.abs(trade.profit).toFixed(2)}`;
      const roiText = `${isWin ? '+' : ''}${trade.returnPct.toFixed(1)}% ROI`;

      ctx.fillStyle = isWin ? '#10b981' : '#ef4444';
      ctx.font = '900 96px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(pnlText, W - 64, 315);

      ctx.fillStyle = isWin ? '#a7f3d0' : '#fca5a5';
      ctx.font = '800 32px JetBrains Mono, monospace';
      ctx.fillText(`USDT  ·  ${roiText}`, W - 64, 368);
      ctx.textAlign = 'left';

      // Bottom Referral Strip
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.beginPath();
      ctx.roundRect(64, H - 170, W - 128, 108, 20);
      ctx.fill();
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.font = '800 28px Outfit, system-ui, sans-serif';
      ctx.fillText(`¡ÚNETE Y GANA ${referralRewardUsdt} USDT CON MI INVITACIÓN!`, 96, H - 122);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 20px Plus Jakarta Sans, system-ui, sans-serif';
      ctx.fillText(`Código de Referido: `, 96, H - 84);

      ctx.fillStyle = '#22d3ee';
      ctx.font = '800 22px JetBrains Mono, monospace';
      ctx.fillText(referralCode, 305, H - 84);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 18px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('pukun-trade.vercel.app', W - 96, H - 84);
      ctx.textAlign = 'left';

      setImageUrl(canvas.toDataURL('image/png'));
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => drawCard(img);
    img.onerror = () => drawCard();
    img.src = '/logo.png';
  }, [trade, referralCode, referralRewardUsdt]);

  if (!trade) return null;

  const isWin = trade.profit >= 0;
  const shareText = `🚀 Mi operación en ${trade.symbol} (${trade.direction}) en Pukun Trade: ${
    isWin ? '+' : '-'
  }$${Math.abs(trade.profit).toFixed(2)} USDT (${isWin ? '+' : ''}${trade.returnPct.toFixed(
    1
  )}%). ¡Regístrate con mi referido (${referralCode}) y gana ${referralRewardUsdt} USDT!: ${shareLink}`;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  function handleDownloadPng() {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `pukun-trade-${trade?.symbol.replace('/', '-')}-pnl.png`;
    a.click();
  }

  async function handleNativeShare() {
    try {
      if (navigator.share && canvasRef.current) {
        const blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, 'image/png'));
        if (blob) {
          const file = new File([blob], 'pukun-trade-pnl.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: `Pukun Trade — ${trade?.symbol} PnL`,
              text: shareText,
              url: shareLink,
              files: [file],
            });
            return;
          }
        }
        await navigator.share({
          title: `Pukun Trade — ${trade?.symbol} PnL`,
          text: shareText,
          url: shareLink,
        });
        return;
      }
      await handleCopyLink();
    } catch {
      await handleCopyLink();
    }
  }

  return (
    <div
      className="fixed inset-0 z-95 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-amber-400/35 bg-[#111520] p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span>Compartir Operación + Referido ({referralRewardUsdt} USDT)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hidden canvas + Live Preview Image */}
        <canvas ref={canvasRef} className="hidden" />
        <div className="rounded-xl overflow-hidden border border-white/15 bg-[#090B10]">
          {imageUrl ? (
            <img src={imageUrl} alt="Vista previa PnL Pukun Trade" className="w-full h-auto block" />
          ) : (
            <div className="h-48 flex items-center justify-center text-xs text-slate-400">
              Generando tarjeta PnL...
            </div>
          )}
        </div>

        {/* Referral Link Box */}
        <div className="rounded-xl border border-white/10 bg-[#090B10] px-3 py-2.5 flex items-center justify-between gap-2 text-xs">
          <span className="font-mono text-cyan-300 truncate">{shareLink}</span>
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white shrink-0 cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleNativeShare}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-amber-500 to-cyan-500 py-2.5 text-xs font-bold text-slate-950 hover:brightness-110 cursor-pointer"
          >
            <Share2 className="h-4 w-4" />
            <span>Compartir Imagen + Enlace</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 py-2.5 text-xs font-semibold text-white cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Descargar Tarjeta PNG</span>
          </button>
        </div>
      </div>
    </div>
  );
}

