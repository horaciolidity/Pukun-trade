import { createClient } from '@supabase/supabase-js';

// Official OxaPay v1 network names (verified via https://api.oxapay.com/v1/common/networks)
const V1_NETWORK_MAP: Record<string, string> = {
  Tron: 'Tron Network',
  'Tron (TRC-20)': 'Tron Network',
  'BNB Smart Chain': 'Binance Smart Chain',
  BSC: 'Binance Smart Chain',
  Ethereum: 'Ethereum Network',
  'Ethereum (ERC-20)': 'Ethereum Network',
  Polygon: 'Polygon Network',
  Solana: 'Solana Network',
  Bitcoin: 'Bitcoin Network',
  Base: 'Base Network',
  TON: 'TON Network',
  Dogecoin: 'Dogecoin Network',
  Litecoin: 'Litecoin Network',
  Ripple: 'Ripple',
};

const LEGACY_NETWORK_MAP: Record<string, string> = {
  Tron: 'TRC20',
  'Tron (TRC-20)': 'TRC20',
  'BNB Smart Chain': 'BEP20',
  BSC: 'BEP20',
  Ethereum: 'ERC20',
  'Ethereum (ERC-20)': 'ERC20',
  Polygon: 'Polygon',
  Solana: 'Solana',
  Bitcoin: 'Bitcoin',
  Base: 'Base',
  TON: 'TON',
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const merchantKey = (process.env.OXAPAY_MERCHANT_API_KEY || '').trim();
  if (!merchantKey) {
    return res.status(500).json({
      error: 'Falta configurar OXAPAY_MERCHANT_API_KEY en Vercel (Settings -> Environment Variables).',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const userId = String(body.userId || '').trim();
    const email = String(body.email || '').trim();
    const currency = String(body.currency || body.asset || 'USDT').trim().toUpperCase();
    const network = String(body.network || 'Tron').trim();
    const v1Network = V1_NETWORK_MAP[network] || network;
    const legacyNetwork = LEGACY_NETWORK_MAP[network] || network;
    const cacheKey = `${v1Network}`;

    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido para generar tu dirección única.' });
    }

    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

    // 1. Check if this user already has a saved real OxaPay static address for this network
    if (supabase) {
      try {
        const { data: existing } = await supabase
          .from('user_deposit_addresses')
          .select('address')
          .eq('user_id', userId)
          .eq('network', cacheKey)
          .maybeSingle();

        if (existing?.address) {
          return res.status(200).json({
            address: existing.address,
            network,
            oxaNetwork: v1Network,
            provider: 'OXAPAY',
            cached: true,
          });
        }
      } catch {
        // table may not exist yet — continue to OxaPay
      }
    }

    const appUrl = (process.env.APP_URL || 'https://pukun-trade.vercel.app').replace(/\/$/, '');
    const callbackUrl = `${appUrl}/api/oxapay/webhook`;
    const orderId = `pukun_${userId}_${legacyNetwork}`;
    const description = `Pukun Trade - ${email || userId} (${v1Network})`;

    let address = '';
    let v1Error = '';

    // 2. Call OxaPay v1 Static Address API with exact official network name
    try {
      const v1Res = await fetch('https://api.oxapay.com/v1/payment/static-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          merchant_api_key: merchantKey,
        },
        body: JSON.stringify({
          network: v1Network,
          callback_url: callbackUrl,
          order_id: orderId,
          description,
          auto_withdrawal: false,
        }),
      });
      const v1Json = (await v1Res.json()) as any;
      address = v1Json?.data?.address || v1Json?.address || '';
      if (!address) {
        v1Error = v1Json?.message || v1Json?.error?.message || `OxaPay v1 HTTP ${v1Res.status}`;
      }
    } catch (e) {
      v1Error = e instanceof Error ? e.message : 'Error conectando con OxaPay v1';
    }

    // 3. Fallback to OxaPay Legacy Static Address API (includes required currency + network)
    if (!address) {
      const legacyRes = await fetch('https://api.oxapay.com/merchants/request/staticaddress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: merchantKey,
          currency,
          network: legacyNetwork,
          callbackUrl,
          orderId,
          description,
        }),
      });
      const legacyJson = (await legacyRes.json()) as any;
      address = legacyJson?.address || legacyJson?.data?.address || '';
      if (!address) {
        const finalMsg =
          v1Error && v1Error.toLowerCase().includes('invalid')
            ? `OxaPay rechazó la clave o red (${v1Error}). Verifica tu Merchant API Key en OxaPay Dashboard -> Merchant API.`
            : legacyJson?.message || v1Error || `OxaPay no devolvió dirección para ${currency} en ${v1Network}.`;
        return res.status(502).json({ error: finalMsg });
      }
    }

    // 4. Persist static address in Supabase for permanent reuse
    if (supabase && address) {
      try {
        await supabase.from('user_deposit_addresses').upsert(
          {
            user_id: userId,
            user_email: email,
            network: cacheKey,
            address,
            provider: 'OXAPAY',
          },
          { onConflict: 'user_id,network' }
        );
      } catch {
        // ignore if table not created yet
      }
    }

    return res.status(200).json({
      address,
      network,
      oxaNetwork: v1Network,
      provider: 'OXAPAY',
      cached: false,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Error interno generando dirección OxaPay',
    });
  }
}
