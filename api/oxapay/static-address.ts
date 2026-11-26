import { createClient } from '@supabase/supabase-js';

const NETWORK_MAP: Record<string, string> = {
  Tron: 'TRC20',
  'Tron (TRC-20)': 'TRC20',
  'BNB Smart Chain': 'BEP20',
  Ethereum: 'ERC20',
  'Ethereum (ERC-20)': 'ERC20',
  Polygon: 'POLYGON',
  Arbitrum: 'ARBITRUM',
  Optimism: 'OPTIMISM',
  Base: 'BASE',
  Bitcoin: 'BTC',
  Solana: 'SOL',
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
    const network = String(body.network || 'Tron').trim();
    const oxaNetwork = NETWORK_MAP[network] || network.toUpperCase();

    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido para generar tu dirección única.' });
    }

    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

    // 1. Check if this user already has a static address for this network in Supabase
    if (supabase) {
      try {
        const { data: existing } = await supabase
          .from('user_deposit_addresses')
          .select('address')
          .eq('user_id', userId)
          .eq('network', oxaNetwork)
          .maybeSingle();

        if (existing?.address) {
          return res.status(200).json({
            address: existing.address,
            network,
            oxaNetwork,
            provider: 'OXAPAY',
            cached: true,
          });
        }
      } catch {
        // table may not exist yet — continue to OxaPay directly
      }
    }

    const appUrl = (process.env.APP_URL || 'https://pukun-trade.vercel.app').replace(/\/$/, '');
    const callbackUrl = `${appUrl}/api/oxapay/webhook`;
    const orderId = `pukun_${userId}_${oxaNetwork}`;
    const description = `Pukun Trade Deposit - ${email || userId} (${oxaNetwork})`;

    let address = '';
    let lastErr = '';

    // 2. Call OxaPay v1 Static Address API
    try {
      const v1Res = await fetch('https://api.oxapay.com/v1/payment/static-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          merchant_api_key: merchantKey,
        },
        body: JSON.stringify({
          network: oxaNetwork,
          callback_url: callbackUrl,
          order_id: orderId,
          description,
          auto_withdrawal: false,
        }),
      });
      const v1Json = (await v1Res.json()) as any;
      address = v1Json?.data?.address || v1Json?.address || '';
      if (!address) {
        lastErr = v1Json?.message || v1Json?.error?.message || `OxaPay v1 status ${v1Res.status}`;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'Error OxaPay v1';
    }

    // 3. Fallback to OxaPay Legacy Static Address endpoint if v1 didn't return an address
    if (!address) {
      const legacyRes = await fetch('https://api.oxapay.com/merchants/request/staticaddress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: merchantKey,
          network: oxaNetwork,
          callbackUrl,
          orderId,
          description,
        }),
      });
      const legacyJson = (await legacyRes.json()) as any;
      address = legacyJson?.address || legacyJson?.data?.address || '';
      if (!address) {
        return res.status(502).json({
          error: legacyJson?.message || lastErr || `OxaPay no devolvió dirección para la red ${oxaNetwork}.`,
        });
      }
    }

    // 4. Persist static address in Supabase for permanent reuse
    if (supabase && address) {
      try {
        await supabase.from('user_deposit_addresses').upsert(
          {
            user_id: userId,
            user_email: email,
            network: oxaNetwork,
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
      oxaNetwork,
      provider: 'OXAPAY',
      cached: false,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Error interno generando dirección OxaPay',
    });
  }
}

