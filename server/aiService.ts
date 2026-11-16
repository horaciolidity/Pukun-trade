import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import { db } from './db.ts';
import { computeTechnicalIndicators, MarketRow } from './marketEngine.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface MarketIntelAnalysis {
  id: string;
  symbol: string;
  classification: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
  prob_bullish: number;
  prob_bearish: number;
  prob_sideways: number;
  timeframe: string;
  indicators: Record<string, number | string>;
  news: Array<{ title: string; source: string; note: string }>;
  reasoning: string;
  risks: string;
  alternatives: string;
  provider: string;
  created_at: number;
}

function normalizeProbabilities(b: number, s: number, l: number): [number, number, number] {
  const total = Math.max(1, b + s + l);
  let nb = Math.round((b / total) * 100);
  let ns = Math.round((s / total) * 100);
  let nl = 100 - nb - ns;
  if (nl < 0) {
    nb = Math.max(0, nb + nl);
    nl = 100 - nb - ns;
  }
  return [nb, ns, nl];
}

export async function analyzeMarketWithAI(symbol: string, timeframe = '1H'): Promise<MarketIntelAnalysis> {
  const market = db.prepare(`SELECT * FROM markets WHERE symbol = ?`).get(symbol) as MarketRow | undefined;
  if (!market) {
    throw new Error(`Mercado ${symbol} no encontrado.`);
  }

  const ind = computeTechnicalIndicators(symbol);
  const indicatorsSummary = {
    precioActual: market.last_price,
    cambio24hPct: market.change_24h,
    volumen24hUsdt: market.volume_24h,
    rsi14: ind.rsi14,
    ema9: ind.ema9,
    ema21: ind.ema21,
    sma20: ind.sma20,
    macd: ind.macd,
    bbSuperior: ind.bbUpper,
    bbInferior: ind.bbLower,
    atr14: ind.atr14,
    soporte: ind.support,
    resistencia: ind.resistance,
    volatilidadPct: ind.volatilityPct,
    fundingRate: market.funding_rate,
    openInterest: market.open_interest,
    fuentePrecio: market.price_source,
  };

  const activeProvider = db
    .prepare(`SELECT * FROM ai_providers WHERE enabled = 1 ORDER BY priority ASC LIMIT 1`)
    .get() as { name: string; provider_type: string; model: string } | undefined;

  const ai = getGeminiClient();

  if (ai && (!activeProvider || activeProvider.provider_type === 'GEMINI')) {
    try {
      const prompt = `Analiza el activo cripto ${symbol} en temporalidad ${timeframe} usando ÚNICAMENTE estos datos reales observados del motor de mercado (NO inventes precios, ni noticias externas, ni garantías de retorno):
${JSON.stringify(indicatorsSummary, null, 2)}

Reglas estrictas:
1. Las tres probabilidades (probBullish, probBearish, probSideways) deben ser enteros >= 0 y sumar exactamente 100.
2. Clasifica como ALCISTA, BAJISTA o LATERAL según la probabilidad dominante.
3. Distingue claramente los datos observados (RSI, EMA, MACD, Bollinger, ATR, Volumen, Funding Rate) de las inferencias probabilísticas.
4. No inventes noticias de última hora; si no hay feed externo de noticias conectado, indica explícitamente que el análisis se basa en métricas técnicas y flujo cuantitativo.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Eres un analista cuantitativo senior de mercados cripto. Responde en español técnico, claro, objetivo y prudente. Nunca garantices ganancias ni fabriques noticias.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              classification: { type: Type.STRING, description: 'ALCISTA, BAJISTA o LATERAL' },
              probBullish: { type: Type.INTEGER },
              probBearish: { type: Type.INTEGER },
              probSideways: { type: Type.INTEGER },
              reasoning: { type: Type.STRING },
              risks: { type: Type.STRING },
              alternatives: { type: Type.STRING },
            },
            required: ['classification', 'probBullish', 'probBearish', 'probSideways', 'reasoning', 'risks', 'alternatives'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        classification: string;
        probBullish: number;
        probBearish: number;
        probSideways: number;
        reasoning: string;
        risks: string;
        alternatives: string;
      };

      const [pb, ps, pl] = normalizeProbabilities(
        Number(parsed.probBullish || 34),
        Number(parsed.probBearish || 33),
        Number(parsed.probSideways || 33)
      );
      const cls: 'ALCISTA' | 'BAJISTA' | 'LATERAL' =
        pb >= ps && pb >= pl ? 'ALCISTA' : ps >= pb && ps >= pl ? 'BAJISTA' : 'LATERAL';

      const record: MarketIntelAnalysis = {
        id: `intel_${crypto.randomUUID().slice(0, 12)}`,
        symbol,
        classification: cls,
        prob_bullish: pb,
        prob_bearish: ps,
        prob_sideways: pl,
        timeframe,
        indicators: indicatorsSummary,
        news: [
          {
            title: 'Sin feed externo de noticias conectado en este entorno',
            source: 'Motor Cuantitativo Local',
            note: 'El análisis utiliza exclusivamente indicadores técnicos reales, volatilidad, volumen y estructura de soporte/resistencia.',
          },
        ],
        reasoning: parsed.reasoning,
        risks: parsed.risks,
        alternatives: parsed.alternatives,
        provider: 'Google Gemini (gemini-4-hydrogen)',
        created_at: Date.now(),
      };

      saveIntelRecord(record);
      return record;
    } catch (err) {
      console.error('Gemini API fallback triggered:', err);
    }
  }

  // Deterministic quantitative fallback when GEMINI_API_KEY is not configured or unavailable
  let rawBull = 33;
  let rawBear = 33;
  let rawSide = 34;

  if (ind.ema9 > ind.ema21) rawBull += 14;
  else rawBear += 14;

  if (ind.rsi14 > 55 && ind.rsi14 < 72) rawBull += 12;
  else if (ind.rsi14 < 45 && ind.rsi14 > 28) rawBear += 12;
  else if (ind.rsi14 >= 72) rawBear += 8;
  else if (ind.rsi14 <= 28) rawBull += 8;
  else rawSide += 14;

  if (ind.macd > ind.macdSignal) rawBull += 8;
  else rawBear += 8;

  const [pb, ps, pl] = normalizeProbabilities(rawBull, rawBear, rawSide);
  const cls: 'ALCISTA' | 'BAJISTA' | 'LATERAL' =
    pb >= ps && pb >= pl ? 'ALCISTA' : ps >= pb && ps >= pl ? 'BAJISTA' : 'LATERAL';

  const record: MarketIntelAnalysis = {
    id: `intel_${crypto.randomUUID().slice(0, 12)}`,
    symbol,
    classification: cls,
    prob_bullish: pb,
    prob_bearish: ps,
    prob_sideways: pl,
    timeframe,
    indicators: indicatorsSummary,
    news: [
      {
        title: 'Evaluación técnica sin feed de noticias externo conectado',
        source: 'Motor Cuantitativo Interno',
        note: 'Configura GEMINI_API_KEY en Secrets para enriquecer la síntesis con Gemini 4 Hydrogen.',
      },
    ],
    reasoning: `Datos observados en ${symbol} (${timeframe}): precio actual ${market.last_price} USDT (${market.change_24h >= 0 ? '+' : ''}${market.change_24h}%), RSI(14) en ${ind.rsi14}, EMA9 (${ind.ema9}) ${ind.ema9 >= ind.ema21 ? 'por encima de' : 'por debajo de'} EMA21 (${ind.ema21}) y ATR(14) en ${ind.atr14}. Inferencia estadística: sesgo ${cls.toLowerCase()} con banda superior en ${ind.bbUpper} y soporte reciente en ${ind.support}.`,
    risks: `Volatilidad medida del ${ind.volatilityPct}%. Una pérdida del soporte ${ind.support} o incremento brusco del Funding Rate (${(market.funding_rate * 100).toFixed(4)}%) invalidaría la lectura actual.`,
    alternatives: `Escenario alternativo: consolidación lateral entre ${ind.support} y ${ind.resistance} si el volumen disminuye frente al promedio reciente.`,
    provider: 'Motor Cuantitativo Interno (Fallback sin clave externa)',
    created_at: Date.now(),
  };

  saveIntelRecord(record);
  return record;
}

function saveIntelRecord(rec: MarketIntelAnalysis) {
  db.prepare(`
    INSERT INTO market_intel (
      id, symbol, classification, prob_bullish, prob_bearish, prob_sideways,
      timeframe, indicators_json, news_json, reasoning, risks, alternatives, provider, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rec.id,
    rec.symbol,
    rec.classification,
    rec.prob_bullish,
    rec.prob_bearish,
    rec.prob_sideways,
    rec.timeframe,
    JSON.stringify(rec.indicators),
    JSON.stringify(rec.news),
    rec.reasoning,
    rec.risks,
    rec.alternatives,
    rec.provider,
    rec.created_at
  );
}

export function generateTechnicalSignal(symbol: string, timeframe = '15M') {
  const market = db.prepare(`SELECT * FROM markets WHERE symbol = ?`).get(symbol) as MarketRow | undefined;
  if (!market) throw new Error('Mercado inválido');

  const ind = computeTechnicalIndicators(symbol);
  const direction: 'LONG' | 'SHORT' = ind.ema9 >= ind.ema21 ? 'LONG' : 'SHORT';
  const category =
    ind.volatilityPct > 1.2
      ? 'HIGH_VOLATILITY'
      : direction === 'LONG'
      ? 'BULLISH'
      : 'BEARISH';

  const riskDist = Math.max(market.last_price * 0.012, ind.atr14 * 1.8);
  const stopLoss =
    direction === 'LONG'
      ? Number((market.last_price - riskDist).toFixed(market.price_precision))
      : Number((market.last_price + riskDist).toFixed(market.price_precision));
  const takeProfit =
    direction === 'LONG'
      ? Number((market.last_price + riskDist * 2.1).toFixed(market.price_precision))
      : Number((market.last_price - riskDist * 2.1).toFixed(market.price_precision));

  const confidence = Math.min(89, Math.max(54, Math.round(60 + Math.abs(ind.rsi14 - 50) * 0.7)));
  const indicatorsList = [
    `RSI(14): ${ind.rsi14}`,
    `EMA9/21: ${ind.ema9 >= ind.ema21 ? 'Cruce Alcista' : 'Cruce Bajista'}`,
    `MACD: ${ind.macd >= ind.macdSignal ? 'Positivo' : 'Negativo'}`,
  ];

  const signal = {
    id: `sig_${crypto.randomUUID().slice(0, 10)}`,
    symbol,
    direction,
    category,
    current_price: market.last_price,
    entry_price: market.last_price,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    timeframe,
    indicators_json: JSON.stringify(indicatorsList),
    confidence,
    generator_bot: 'Neural Predictive Engine',
    outcome: 'OPEN',
    created_at: Date.now(),
  };

  db.prepare(`
    INSERT INTO signals (
      id, symbol, direction, category, current_price, entry_price, stop_loss, take_profit,
      timeframe, indicators_json, confidence, generator_bot, outcome, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signal.id,
    signal.symbol,
    signal.direction,
    signal.category,
    signal.current_price,
    signal.entry_price,
    signal.stop_loss,
    signal.take_profit,
    signal.timeframe,
    signal.indicators_json,
    signal.confidence,
    signal.generator_bot,
    signal.outcome,
    signal.created_at
  );

  return { ...signal, indicators: indicatorsList };
}
