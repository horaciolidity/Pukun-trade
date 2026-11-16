import { useEffect, useRef } from 'react';
import { formatPrice } from '../api';
import { QuickTradeItem } from '../types';
import { DEFAULT_THERMAL_COLORS, QuickTradeThermalColors } from '../utils/quickTradeMath';

export interface PulsePoint {
  time: number; // ms epoch
  price: number;
  volume: number;
}

export interface ChartIndicatorsToggle {
  ema: boolean;
  bollinger: boolean;
  volume: boolean;
}

interface Props {
  symbol: string;
  points: PulsePoint[];
  windowSec: number;
  activeTrade?: QuickTradeItem;
  hoverDirection: 'UP' | 'DOWN' | null;
  lastClosedTrade?: QuickTradeItem | null;
  indicatorsToggle: ChartIndicatorsToggle;
  isLivePublicSource: boolean;
  animationsEnabled?: boolean;
  thermalColors?: QuickTradeThermalColors;
  height?: number;
}

function computeSeriesEma(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  let ema = values[0];
  return values.map((v, i) => {
    ema = i === 0 ? v : v * k + ema * (1 - k);
    return ema;
  });
}

function computeSeriesBollinger(values: number[], period = 20) {
  const upper: number[] = [];
  const lower: number[] = [];
  const middle: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = values.slice(start, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    middle.push(mean);
    upper.push(mean + 2 * std);
    lower.push(mean - 2 * std);
  }
  return { upper, middle, lower };
}

export function QuickTradePulseChart({
  symbol,
  points,
  windowSec,
  activeTrade,
  hoverDirection,
  lastClosedTrade,
  indicatorsToggle,
  isLivePublicSource,
  animationsEnabled = true,
  thermalColors = DEFAULT_THERMAL_COLORS,
  height = 410,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Store latest props in refs so the 60fps RAF loop never restarts on tick updates
  const dataRef = useRef({
    symbol,
    points,
    windowSec,
    activeTrade,
    hoverDirection,
    lastClosedTrade,
    indicatorsToggle,
    isLivePublicSource,
    animationsEnabled,
    thermalColors,
  });
  dataRef.current = {
    symbol,
    points,
    windowSec,
    activeTrade,
    hoverDirection,
    lastClosedTrade,
    indicatorsToggle,
    isLivePublicSource,
    animationsEnabled,
    thermalColors,
  };

  // Smooth interpolated display price for the ECG head
  const displayPriceRef = useRef<number>(points[points.length - 1]?.price || 0);
  const prevSymbolRef = useRef<string>(symbol);

  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      displayPriceRef.current = points[points.length - 1]?.price || 0;
    }
  }, [symbol, points]);

  useEffect(() => {
    let rafId = 0;

    const renderFrame = (rafTime: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafId = requestAnimationFrame(renderFrame);
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
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const {
        points: pts,
        windowSec: winSec,
        activeTrade: trade,
        hoverDirection: hoverDir,
        lastClosedTrade: closedTrade,
        indicatorsToggle: indToggle,
        animationsEnabled: animOn,
        thermalColors: tColors,
      } = dataRef.current;

      const now = Date.now();
      const padLeft = 14;
      const padRight = 88;
      const padTop = 22;
      const padBottom = 30;
      const chartW = Math.max(120, width - padLeft - padRight);
      const chartH = Math.max(100, h - padTop - padBottom);

      // Background
      ctx.fillStyle = '#080B11';
      ctx.fillRect(0, 0, width, h);

      // Subtle radial glow behind live price area
      const bgGlow = ctx.createRadialGradient(padLeft + chartW * 0.78, padTop + chartH * 0.45, 10, padLeft + chartW * 0.78, padTop + chartH * 0.45, chartW * 0.55);
      bgGlow.addColorStop(0, 'rgba(37, 99, 235, 0.08)');
      bgGlow.addColorStop(1, 'rgba(8, 11, 17, 0)');
      ctx.fillStyle = bgGlow;
      ctx.fillRect(padLeft, padTop, chartW, chartH);

      if (pts.length === 0) {
        ctx.fillStyle = '#64748B';
        ctx.font = '12px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('Sincronizando stream de cotizaciones...', padLeft + 20, padTop + chartH / 2);
        ctx.restore();
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const latestRealPrice = pts[pts.length - 1].price;
      if (displayPriceRef.current <= 0) displayPriceRef.current = latestRealPrice;
      // Exponential smoothing for buttery 60fps ECG head motion without altering authoritative price labels
      if (animOn) {
        displayPriceRef.current += (latestRealPrice - displayPriceRef.current) * 0.16;
        if (Math.abs(latestRealPrice - displayPriceRef.current) < latestRealPrice * 0.000002) {
          displayPriceRef.current = latestRealPrice;
        }
      } else {
        displayPriceRef.current = latestRealPrice;
      }
      const livePrice = displayPriceRef.current;

      // Time window mapping: latest point advances at ~78% of chart width, leaving forward runway for active expiration
      const hasForwardRunway = Boolean(trade);
      const headRatio = hasForwardRunway ? 0.74 : 0.88;
      const windowMs = winSec * 1000;
      const visibleLeftMs = now - windowMs * headRatio;
      const visibleRightMs = visibleLeftMs + windowMs;

      // Filter points inside window + 1 anchor before left edge for continuous curve entry
      let firstVisibleIdx = pts.findIndex((p) => p.time >= visibleLeftMs);
      if (firstVisibleIdx === -1) firstVisibleIdx = Math.max(0, pts.length - 2);
      const startSliceIdx = Math.max(0, firstVisibleIdx - 1);
      const visiblePts = pts.slice(startSliceIdx);

      // Keep all real tick anchors intact and append a live advancing ECG head at `now`
      const lastVisible = visiblePts[visiblePts.length - 1];
      const renderPts: PulsePoint[] = [...visiblePts];
      if (now - lastVisible.time > 32) {
        renderPts.push({
          time: now,
          price: livePrice,
          volume: lastVisible.volume,
        });
      } else {
        renderPts[renderPts.length - 1] = {
          ...lastVisible,
          price: livePrice,
        };
      }
      if (renderPts.length === 1) {
        renderPts.unshift({ time: now - 1000, price: livePrice, volume: renderPts[0].volume });
      }

      const allPrices = renderPts.map((p) => p.price);
      if (trade && trade.symbol === dataRef.current.symbol) allPrices.push(trade.entry_price);
      if (closedTrade && closedTrade.symbol === dataRef.current.symbol && closedTrade.close_price > 0) {
        allPrices.push(closedTrade.entry_price, closedTrade.close_price);
      }

      // Compute optional overlays on full points so EMA/BB remain stable
      const fullPrices = pts.map((p) => p.price);
      const ema9All = indToggle.ema ? computeSeriesEma(fullPrices, 9) : [];
      const ema21All = indToggle.ema ? computeSeriesEma(fullPrices, 21) : [];
      const bbAll = indToggle.bollinger ? computeSeriesBollinger(fullPrices, 20) : null;

      if (indToggle.bollinger && bbAll) {
        const sliceUpper = bbAll.upper.slice(startSliceIdx);
        const sliceLower = bbAll.lower.slice(startSliceIdx);
        allPrices.push(...sliceUpper, ...sliceLower);
      }

      const rawMin = Math.min(...allPrices);
      const rawMax = Math.max(...allPrices);
      const padSpan = Math.max(rawMax - rawMin, latestRealPrice * 0.0008);
      const minP = rawMin - padSpan * 0.16;
      const maxP = rawMax + padSpan * 0.16;
      const rangeP = Math.max(0.000001, maxP - minP);

      const xForTime = (t: number) => padLeft + ((t - visibleLeftMs) / windowMs) * chartW;
      const yForPrice = (p: number) => padTop + chartH - ((p - minP) / rangeP) * chartH;

      // Discrete financial grid (horizontal & vertical)
      ctx.lineWidth = 1;
      const priceSteps = 5;
      for (let i = 0; i <= priceSteps; i++) {
        const ratio = i / priceSteps;
        const y = padTop + ratio * chartH;
        const val = maxP - ratio * rangeP;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();

        ctx.fillStyle = '#64748B';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`$${formatPrice(val)}`, padLeft + chartW + 8, y + 3.5);
      }

      const timeSteps = 5;
      for (let i = 0; i <= timeSteps; i++) {
        const ratio = i / timeSteps;
        const t = visibleLeftMs + ratio * windowMs;
        const x = padLeft + ratio * chartW;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + chartH);
        ctx.stroke();

        const dt = new Date(t);
        const label = dt.toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        ctx.fillStyle = '#64748B';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        if (x > padLeft + 24 && x < padLeft + chartW - 20) {
          ctx.fillText(label, x, padTop + chartH + 18);
        }
      }

      // Clip chart area for curves and overlays
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, padTop, chartW, chartH);
      ctx.clip();

      // Volume bars at bottom
      if (indToggle.volume) {
        const maxVol = Math.max(1, ...visiblePts.map((p) => p.volume));
        const volMaxH = chartH * 0.18;
        const barW = Math.max(2, Math.min(8, chartW / Math.max(12, visiblePts.length) * 0.55));
        for (let i = 0; i < visiblePts.length; i++) {
          const pt = visiblePts[i];
          const prev = i > 0 ? visiblePts[i - 1] : pt;
          const x = xForTime(pt.time);
          const bh = (pt.volume / maxVol) * volMaxH;
          ctx.fillStyle = pt.price >= prev.price ? 'rgba(16, 185, 129, 0.20)' : 'rgba(239, 68, 68, 0.20)';
          ctx.fillRect(x - barW / 2, padTop + chartH - bh, barW, bh);
        }
      }

      // Bollinger Bands overlay
      if (indToggle.bollinger && bbAll) {
        const drawOverlayLine = (arr: number[], stroke: string, dash: number[] = []) => {
          ctx.beginPath();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1;
          ctx.setLineDash(dash);
          for (let i = startSliceIdx; i < pts.length; i++) {
            const x = xForTime(pts[i].time);
            const y = yForPrice(arr[i]);
            if (i === startSliceIdx) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        };
        drawOverlayLine(bbAll.upper, 'rgba(245, 158, 11, 0.45)', [4, 4]);
        drawOverlayLine(bbAll.lower, 'rgba(245, 158, 11, 0.45)', [4, 4]);
      }

      // EMA 9 & 21 overlays
      if (indToggle.ema) {
        const drawEma = (arr: number[], stroke: string) => {
          ctx.beginPath();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.2;
          for (let i = startSliceIdx; i < pts.length; i++) {
            const x = xForTime(pts[i].time);
            const y = yForPrice(arr[i]);
            if (i === startSliceIdx) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        drawEma(ema9All, 'rgba(56, 189, 248, 0.72)');
        drawEma(ema21All, 'rgba(168, 85, 247, 0.72)');
      }

      // Active Trade Entry Zone Shading & Reference Line
      let lineColor = '#38BDF8';
      let areaTopColor = 'rgba(56, 189, 248, 0.26)';
      const areaBottomColor = 'rgba(56, 189, 248, 0.0)';

      if (trade) {
        const isWinning =
          (trade.direction === 'UP' && latestRealPrice > trade.entry_price) ||
          (trade.direction === 'DOWN' && latestRealPrice < trade.entry_price);
        lineColor = isWinning
          ? tColors.highProfit
          : latestRealPrice === trade.entry_price
          ? tColors.pending
          : tColors.highLoss;
        areaTopColor = isWinning ? `${tColors.highProfit}44` : `${tColors.highLoss}38`;

        const entryY = yForPrice(trade.entry_price);
        const liveY = yForPrice(livePrice);

        // Shaded profit/loss band between entry price and current price
        ctx.fillStyle = isWinning ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)';
        ctx.fillRect(padLeft, Math.min(entryY, liveY), chartW, Math.abs(liveY - entryY));

        // Horizontal entry line
        ctx.strokeStyle = trade.direction === 'UP' ? 'rgba(16, 185, 129, 0.85)' : 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, entryY);
        ctx.lineTo(padLeft + chartW, entryY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Vertical expiration line on the forward runway
        if (trade.expires_at >= visibleLeftMs && trade.expires_at <= visibleRightMs) {
          const expX = xForTime(trade.expires_at);
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(expX, padTop);
          ctx.lineTo(expX, padTop + chartH);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('CIERRE', expX, padTop + 13);
        }
      } else if (hoverDir) {
        // Preview directional bias line when hovering ALCISTA / BAJISTA
        const hoverY = yForPrice(livePrice);
        ctx.strokeStyle = hoverDir === 'UP' ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, hoverY);
        ctx.lineTo(padLeft + chartW, hoverY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Smooth Catmull-Rom / quadratic midpoint curve path (ECG continuous pulse)
      const coords = renderPts.map((p) => ({ x: xForTime(p.time), y: yForPrice(p.price) }));

      const traceCurve = () => {
        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        for (let i = 1; i < coords.length - 1; i++) {
          const xc = (coords[i].x + coords[i + 1].x) / 2;
          const yc = (coords[i].y + coords[i + 1].y) / 2;
          ctx.quadraticCurveTo(coords[i].x, coords[i].y, xc, yc);
        }
        const last = coords[coords.length - 1];
        ctx.lineTo(last.x, last.y);
      };

      // Gradient area under curve
      traceCurve();
      const lastCoord = coords[coords.length - 1];
      ctx.lineTo(lastCoord.x, padTop + chartH);
      ctx.lineTo(coords[0].x, padTop + chartH);
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
      areaGrad.addColorStop(0, areaTopColor);
      areaGrad.addColorStop(1, areaBottomColor);
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Main glowing ECG price line
      traceCurve();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Entry Marker Dot if trade is active and in visible window
      if (trade && trade.created_at >= visibleLeftMs) {
        const ex = xForTime(trade.created_at);
        const ey = yForPrice(trade.entry_price);
        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fillStyle = trade.direction === 'UP' ? '#10B981' : '#EF4444';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#080B11';
        ctx.stroke();
      }

      // Recently Closed Trade Marker (Entry -> Close)
      if (!trade && closedTrade && closedTrade.symbol === dataRef.current.symbol && closedTrade.close_price > 0 && closedTrade.expires_at >= visibleLeftMs) {
        const cx = xForTime(closedTrade.expires_at);
        const cy = yForPrice(closedTrade.close_price);
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = closedTrade.status === 'WON' ? '#10B981' : closedTrade.status === 'LOST' ? '#EF4444' : '#94A3B8';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
      }

      // Live Price Horizontal Guide Line
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(lastCoord.x, lastCoord.y);
      ctx.lineTo(padLeft + chartW, lastCoord.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // ECG Pulsing Glow Head at the latest coordinate
      const pulsePhase = animOn ? (Math.sin(rafTime / 240) + 1) / 2 : 0.35; // 0..1 smooth heartbeat
      const outerR = 7 + pulsePhase * 6;
      ctx.beginPath();
      ctx.arc(lastCoord.x, lastCoord.y, outerR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.32 - pulsePhase * 0.2})`;
      if (trade) {
        const isWinHead =
          (trade.direction === 'UP' && latestRealPrice > trade.entry_price) ||
          (trade.direction === 'DOWN' && latestRealPrice < trade.entry_price);
        ctx.fillStyle = isWinHead
          ? `rgba(16, 185, 129, ${0.34 - pulsePhase * 0.22})`
          : `rgba(239, 68, 68, ${0.34 - pulsePhase * 0.22})`;
      }
      ctx.fill();

      ctx.beginPath();
      ctx.arc(lastCoord.x, lastCoord.y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore(); // end chart clip

      // Floating Entry Price Tag on Left/Axis if active
      if (trade) {
        const entryY = Math.max(padTop + 10, Math.min(padTop + chartH - 10, yForPrice(trade.entry_price)));
        ctx.fillStyle = trade.direction === 'UP' ? '#065F46' : '#7F1D1D';
        ctx.beginPath();
        ctx.roundRect(padLeft + 6, entryY - 11, 132, 20, 4);
        ctx.fill();
        ctx.strokeStyle = trade.direction === 'UP' ? '#10B981' : '#EF4444';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#F8FAFC';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`ENT $${formatPrice(trade.entry_price)}`, padLeft + 12, entryY + 2.5);
      }

      // Floating Live Price Badge on Right Price Axis
      const clampedLiveY = Math.max(padTop + 11, Math.min(padTop + chartH - 11, lastCoord.y));
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.roundRect(padLeft + chartW + 2, clampedLiveY - 11, padRight - 6, 22, 4);
      ctx.fill();

      ctx.fillStyle = '#080B11';
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`$${formatPrice(latestRealPrice)}`, padLeft + chartW + 7, clampedLiveY + 3.5);

      // Subtle floating tag next to pulsing dot
      const tagText = `$${formatPrice(latestRealPrice)}`;
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      const tw = ctx.measureText(tagText).width + 14;
      const tx = Math.max(padLeft + 8, Math.min(padLeft + chartW - tw - 8, lastCoord.x - tw / 2));
      const ty = lastCoord.y > padTop + 34 ? lastCoord.y - 28 : lastCoord.y + 14;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, 20, 5);
      ctx.fill();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.fillText(tagText, tx + tw / 2, ty + 13.5);

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [height]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#080B11]">
      <canvas ref={canvasRef} className="block w-full" style={{ height }} />
    </div>
  );
}
