import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import { Candle } from '../types';

export interface ChartPriceLine {
  id: string;
  price: number;
  color: string;
  title: string;
  lineStyle?: number;
  lineWidth?: 1 | 2 | 3 | 4;
}

interface Props {
  candles: Candle[];
  showEma?: boolean;
  showBollinger?: boolean;
  height?: number;
  priceLines?: ChartPriceLine[];
}

function calcEmaSeries(candles: Candle[], period: number) {
  const k = 2 / (period + 1);
  let ema = candles[0]?.close || 0;
  return candles.map((c, idx) => {
    ema = idx === 0 ? c.close : c.close * k + ema * (1 - k);
    return { time: c.time as UTCTimestamp, value: Number(ema.toFixed(4)) };
  });
}

function calcBollinger(candles: Candle[], period = 20) {
  const upper: { time: UTCTimestamp; value: number }[] = [];
  const lower: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = candles.slice(start, i + 1);
    const mean = slice.reduce((a, c) => a + c.close, 0) / slice.length;
    const variance = slice.reduce((a, c) => a + Math.pow(c.close - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    upper.push({ time: candles[i].time as UTCTimestamp, value: Number((mean + 2 * std).toFixed(4)) });
    lower.push({ time: candles[i].time as UTCTimestamp, value: Number((mean - 2 * std).toFixed(4)) });
  }
  return { upper, lower };
}

export function CandlestickChart({
  candles,
  showEma = true,
  showBollinger = false,
  height = 380,
  priceLines = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema9Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema21Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0D1119' },
        textColor: '#94A3B8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(59,130,246,0.45)', width: 1 },
        horzLine: { color: 'rgba(59,130,246,0.45)', width: 1 },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const ema9Series = chart.addSeries(LineSeries, {
      color: '#3B82F6',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ema21Series = chart.addSeries(LineSeries, {
      color: '#8B5CF6',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: 'rgba(245, 158, 11, 0.55)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: 'rgba(245, 158, 11, 0.55)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema9Ref.current = ema9Series;
    ema21Ref.current = ema21Series;
    bbUpperRef.current = bbUpperSeries;
    bbLowerRef.current = bbLowerSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!candles.length || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const formatted = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(formatted);

    volumeSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)',
      }))
    );

    if (ema9Ref.current && ema21Ref.current) {
      if (showEma) {
        ema9Ref.current.setData(calcEmaSeries(candles, 9));
        ema21Ref.current.setData(calcEmaSeries(candles, 21));
      } else {
        ema9Ref.current.setData([]);
        ema21Ref.current.setData([]);
      }
    }

    if (bbUpperRef.current && bbLowerRef.current) {
      if (showBollinger) {
        const bb = calcBollinger(candles);
        bbUpperRef.current.setData(bb.upper);
        bbLowerRef.current.setData(bb.lower);
      } else {
        bbUpperRef.current.setData([]);
        bbLowerRef.current.setData([]);
      }
    }
  }, [candles, showEma, showBollinger]);

  // Draw open orders, Stop Limit triggers, and positions directly on the candlestick chart
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Clear previous price lines
    for (const pl of priceLineRefs.current) {
      try {
        series.removePriceLine(pl);
      } catch {
        // ignore if chart already disposed
      }
    }
    priceLineRefs.current = [];

    for (const line of priceLines) {
      if (!Number.isFinite(line.price) || line.price <= 0) continue;
      try {
        const created = series.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: line.lineWidth ?? 2,
          lineStyle: line.lineStyle ?? 0,
          axisLabelVisible: true,
          title: line.title,
        });
        priceLineRefs.current.push(created);
      } catch {
        // ignore invalid line
      }
    }
  }, [priceLines, candles]);

  return (
    <div
      ref={containerRef}
      className="pukun-chart-watermark w-full overflow-hidden rounded-lg bg-[#0D1119]"
      style={{ height }}
    />
  );
}
