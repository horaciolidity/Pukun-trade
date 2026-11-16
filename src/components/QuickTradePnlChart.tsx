import { useEffect, useRef } from 'react';
import { formatPrice } from '../api';
import { QuickTradePnlPoint } from '../types';
import { DEFAULT_THERMAL_COLORS, QuickTradeThermalColors } from '../utils/quickTradeMath';

interface Props {
  points: QuickTradePnlPoint[];
  entryPrice: number;
  currentPrice: number;
  amount: number;
  payoutPct: number;
  createdAt: number;
  expiresAt: number;
  maxPositivePnl: number;
  maxNegativePnl: number;
  thermalColor: string;
  thermalColors?: QuickTradeThermalColors;
  animationsEnabled?: boolean;
  height?: number;
}

export function QuickTradePnlChart({
  points,
  entryPrice,
  currentPrice,
  amount,
  payoutPct,
  createdAt,
  expiresAt,
  maxPositivePnl,
  maxNegativePnl,
  thermalColor,
  thermalColors = DEFAULT_THERMAL_COLORS,
  animationsEnabled = true,
  height = 190,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dataRef = useRef({
    points,
    entryPrice,
    currentPrice,
    amount,
    payoutPct,
    createdAt,
    expiresAt,
    maxPositivePnl,
    maxNegativePnl,
    thermalColor,
    thermalColors,
    animationsEnabled,
  });
  dataRef.current = {
    points,
    entryPrice,
    currentPrice,
    amount,
    payoutPct,
    createdAt,
    expiresAt,
    maxPositivePnl,
    maxNegativePnl,
    thermalColor,
    thermalColors,
    animationsEnabled,
  };

  const smoothPnlRef = useRef<number>(points[points.length - 1]?.pnl || 0);

  useEffect(() => {
    let rafId = 0;

    const draw = (rafTime: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = container.clientWidth;
      const h = height;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const {
        points: pts,
        entryPrice: entP,
        currentPrice: curP,
        amount: amt,
        payoutPct: pay,
        createdAt: startMs,
        expiresAt: endMs,
        maxPositivePnl: maxPos,
        maxNegativePnl: maxNeg,
        thermalColor: activeColor,
        thermalColors: tColors,
        animationsEnabled: animOn,
      } = dataRef.current;

      const padLeft = 12;
      const padRight = 72;
      const padTop = 22;
      const padBottom = 24;
      const chartW = Math.max(120, width - padLeft - padRight);
      const chartH = Math.max(80, h - padTop - padBottom);

      ctx.fillStyle = '#080B11';
      ctx.fillRect(0, 0, width, h);

      const potentialProfit = (amt * pay) / 100;
      const latestPnl = pts.length > 0 ? pts[pts.length - 1].pnl : 0;
      if (animOn) {
        smoothPnlRef.current += (latestPnl - smoothPnlRef.current) * 0.22;
      } else {
        smoothPnlRef.current = latestPnl;
      }
      const headPnl = smoothPnlRef.current;

      // Y range covers 0, max positive, max negative, and active values cleanly
      const allVals = [0, headPnl, maxPos, maxNeg, ...pts.map((p) => p.pnl)];
      const rawMax = Math.max(potentialProfit * 0.25, ...allVals);
      const rawMin = Math.min(-amt * 0.25, ...allVals);
      const padY = Math.max((rawMax - rawMin) * 0.18, 1);
      const yMax = rawMax + padY;
      const yMin = rawMin - padY;
      const yRange = Math.max(0.1, yMax - yMin);

      const now = Math.min(Date.now(), endMs);
      const totalSpan = Math.max(1000, endMs - startMs);

      const xForTime = (t: number) => {
        const ratio = Math.min(1, Math.max(0, (t - startMs) / totalSpan));
        return padLeft + ratio * chartW;
      };
      const yForPnl = (v: number) => padTop + chartH - ((v - yMin) / yRange) * chartH;

      const zeroY = yForPnl(0);

      // Green Profit Zone (above zero) & Red Loss Zone (below zero)
      const greenGrad = ctx.createLinearGradient(0, padTop, 0, zeroY);
      greenGrad.addColorStop(0, `${tColors.highProfit}22`);
      greenGrad.addColorStop(1, `${tColors.highProfit}05`);
      ctx.fillStyle = greenGrad;
      ctx.fillRect(padLeft, padTop, chartW, Math.max(0, zeroY - padTop));

      const redGrad = ctx.createLinearGradient(0, zeroY, 0, padTop + chartH);
      redGrad.addColorStop(0, `${tColors.highLoss}05`);
      redGrad.addColorStop(1, `${tColors.highLoss}22`);
      ctx.fillStyle = redGrad;
      ctx.fillRect(padLeft, zeroY, chartW, Math.max(0, padTop + chartH - zeroY));

      // Discrete horizontal & vertical grid
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const ratio = i / 4;
        const y = padTop + ratio * chartH;
        const val = yMax - ratio * yRange;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();

        ctx.fillStyle = '#64748B';
        ctx.font = '9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${val >= 0 ? '+' : ''}${val.toFixed(1)}`, padLeft + chartW + 6, y + 3);
      }

      // Zero reference line (Break-Even)
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, zeroY);
      ctx.lineTo(padLeft + chartW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#94A3B8';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('$0.00 EQUILIBRIO', padLeft + 6, zeroY - 5);

      // Max Positive & Max Negative dashed markers
      if (maxPos > 0.05) {
        const mpY = yForPnl(maxPos);
        ctx.strokeStyle = `${tColors.highProfit}75`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, mpY);
        ctx.lineTo(padLeft + chartW, mpY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = tColors.highProfit;
        ctx.fillText(`MÁX +$${maxPos.toFixed(2)}`, padLeft + 6, Math.max(padTop + 10, mpY - 4));
      }

      if (maxNeg < -0.05) {
        const mnY = yForPnl(maxNeg);
        ctx.strokeStyle = `${tColors.highLoss}75`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, mnY);
        ctx.lineTo(padLeft + chartW, mnY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = tColors.highLoss;
        ctx.fillText(`MÁX -$${Math.abs(maxNeg).toFixed(2)}`, padLeft + 6, Math.min(padTop + chartH - 4, mnY + 11));
      }

      // Build curve points
      const renderPts = pts.length > 0 ? [...pts] : [{ t: startMs, p: entP, pnl: 0 }];
      const last = renderPts[renderPts.length - 1];
      if (now - last.t > 40) {
        renderPts.push({ t: now, p: curP, pnl: headPnl });
      } else {
        renderPts[renderPts.length - 1] = { ...last, pnl: headPnl };
      }

      const coords = renderPts.map((pt) => ({ x: xForTime(pt.t), y: yForPnl(pt.pnl) }));

      // Entry Marker at start
      ctx.beginPath();
      ctx.arc(coords[0].x, zeroY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#38BDF8';
      ctx.fill();

      // Smooth PnL trajectory path
      const tracePath = () => {
        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length - 1; i++) {
          const xc = (coords[i].x + coords[i + 1].x) / 2;
          const yc = (coords[i].y + coords[i + 1].y) / 2;
          ctx.quadraticCurveTo(coords[i].x, coords[i].y, xc, yc);
        }
        const tail = coords[coords.length - 1];
        ctx.lineTo(tail.x, tail.y);
      };

      // Area fill toward zero line
      tracePath();
      const tailCoord = coords[coords.length - 1];
      ctx.lineTo(tailCoord.x, zeroY);
      ctx.lineTo(coords[0].x, zeroY);
      ctx.closePath();
      ctx.fillStyle = `${activeColor}28`;
      ctx.fill();

      // Main thermal PnL stroke
      tracePath();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (animOn) {
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 8;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Pulsing head dot
      const pulse = animOn ? (Math.sin(rafTime / 240) + 1) / 2 : 0.3;
      ctx.beginPath();
      ctx.arc(tailCoord.x, tailCoord.y, 5 + pulse * 4, 0, Math.PI * 2);
      ctx.fillStyle = `${activeColor}38`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tailCoord.x, tailCoord.y, 3.8, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // Entry & Current price tags in header corner
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.roundRect(padLeft + chartW - 224, padTop - 16, 220, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#94A3B8';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`ENT $${formatPrice(entP)} · ACT $${formatPrice(curP)}`, padLeft + chartW - 8, padTop - 4.5);

      // Right axis live PnL badge
      const clampedY = Math.max(padTop + 10, Math.min(padTop + chartH - 10, tailCoord.y));
      ctx.fillStyle = activeColor;
      ctx.beginPath();
      ctx.roundRect(padLeft + chartW + 2, clampedY - 9, padRight - 5, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#080B11';
      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${latestPnl >= 0 ? '+' : ''}${latestPnl.toFixed(2)}`, padLeft + chartW + 6, clampedY + 3.5);

      // Bottom time markers
      ctx.fillStyle = '#64748B';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('APERTURA', padLeft, padTop + chartH + 15);
      ctx.textAlign = 'right';
      ctx.fillText('VENCIMIENTO', padLeft + chartW, padTop + chartH + 15);

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [height]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#080B11]">
      <canvas ref={canvasRef} className="block w-full" style={{ height }} />
    </div>
  );
}
