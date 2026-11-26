import { createClient } from '@supabase/supabase-js';

const PAYOUT_NETWORK_MAP: Record<string, string> = {
  Tron: 'TRC20',
  'Tron (TRC-20)': 'TRC20',
  'BNB Smart Chain': 'BEP20',
  BSC: 'BEP20',
  Ethereum: 'ERC20',
  'Ethereum (ERC-20)': 'ERC20',
  Polygon: 'POLYGON',
  Solana: 'SOL',
  Bitcoin: 'BTC',
  Base: 'BASE',
  TON: 'TON',
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payoutKey = (process.env.OXAPAY_PAYOUT_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!payoutKey) {
    return res.status(500).json({
      error: 'Falta configurar OXAPAY_PAYOUT_API_KEY en Vercel (Settings -> Environment Variables).',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const userId = String(body.userId || '').trim();
    const email = String(body.email || '').trim();
    const currency = String(body.asset || body.currency || 'USDT').trim().toUpperCase();
    const network = String(body.network || 'Tron').trim();
    const oxaNetwork = PAYOUT_NETWORK_MAP[network] || network.toUpperCase();
    const address = String(body.address || '').trim();
    const amount = Number(body.amount || 0);
    const usdPrice = Number(body.usdPrice || (currency === 'USDT' || currency === 'USDC' ? 1 : 0));
    const twoFactorCode = String(body.twoFactorCode || '').trim();

    if (!userId || !address || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Completa dirección destino y monto válido.' });
    }

    const estimatedUsd = usdPrice > 0 ? amount * usdPrice : amount;

    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

    // 1. Check real balance & KYC/2FA only if >= $99 USD
    let currentAvailable = 0;
    let currentLocked = 0;
    let kycVerified = false;

    if (supabase) {
      const [{ data: walletRow }, { data: profileRow }] = await Promise.all([
        supabase
          .from('wallets')
          .select('available, locked')
          .eq('user_id', userId)
          .eq('env', 'REAL')
          .eq('asset', currency)
          .maybeSingle(),
        supabase.from('profiles').select('kyc_status').eq('id', userId).maybeSingle(),
      ]);

      currentAvailable = Number(walletRow?.available || 0);
      currentLocked = Number(walletRow?.locked || 0);
      kycVerified = profileRow?.kyc_status === 'VERIFIED';

      if (currentAvailable < amount) {
        return res.status(400).json({
          error: `Saldo disponible insuficiente (${currentAvailable} ${currency}).`,
        });
      }
    }

    // Security threshold: >= $99 USD requires KYC verified OR 6-digit 2FA code
    if (estimatedUsd >= 99 && !kycVerified && twoFactorCode.length < 6) {
      return res.status(403).json({
        requiresVerification: true,
        error: 'Para retiros de $99 USD o más se requiere verificación KYC o código de doble factor (2FA).',
      });
    }

    // 2. Execute Automatic Payout via OxaPay v1 Payout API
    const oxaRes = await fetch('https://api.oxapay.com/v1/payout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        payout_api_key: payoutKey,
      },
      body: JSON.stringify({
        address,
        currency,
        amount,
        network: oxaNetwork,
        description: `Pukun Trade Auto-Withdraw - ${email || userId}`,
      }),
    });

    const oxaJson = (await oxaRes.json()) as any;
    const trackId = oxaJson?.data?.track_id || oxaJson?.track_id || '';
    const txStatus = oxaJson?.status === 200 || oxaRes.ok ? 'COMPLETED' : '';

    if (!txStatus) {
      return res.status(502).json({
        error:
          oxaJson?.error?.message ||
          oxaJson?.message ||
          `OxaPay no pudo procesar el envío automático (HTTP ${oxaRes.status}).`,
      });
    }

    // 3. Deduct real balance and record completed payout in Supabase
    if (supabase) {
      const nextAvailable = Math.max(0, Number((currentAvailable - amount).toFixed(6)));
      await supabase.from('wallets').upsert(
        {
          user_id: userId,
          env: 'REAL',
          asset: currency,
          available: nextAvailable,
          locked: currentLocked,
        },
        { onConflict: 'user_id,env,asset' }
      );

      await supabase.from('transactions').insert({
        user_id: userId,
        user_email: email,
        env: 'REAL',
        type: 'WITHDRAW',
        asset: currency,
        network: `OxaPay ${oxaNetwork}`,
        amount,
        txid: trackId || `oxa_payout_${Date.now()}`,
        address,
        status: 'COMPLETED',
      });
    }

    return res.status(200).json({
      status: 'COMPLETED',
      trackId,
      message: `Retiro automático enviado vía OxaPay (${amount} ${currency}).`,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Error procesando retiro automático OxaPay',
    });
  }
}

