import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const merchantKey = (process.env.OXAPAY_MERCHANT_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!merchantKey) {
    return res.status(500).send('Missing OXAPAY_MERCHANT_API_KEY');
  }

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const receivedHmac = String(req.headers?.hmac || req.headers?.['x-oxapay-hmac'] || '').trim();

    if (receivedHmac) {
      const expectedHmac = crypto.createHmac('sha512', merchantKey).update(rawBody).digest('hex');
      if (receivedHmac.toLowerCase() !== expectedHmac.toLowerCase()) {
        return res.status(403).send('Invalid HMAC signature');
      }
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const statusRaw = String(payload.status || '').toLowerCase();
    const trackId = String(payload.track_id || payload.trackId || '');
    const txid = String(payload.txID || payload.tx_hash || payload.txid || trackId || `oxa_${Date.now()}`);
    const orderId = String(payload.order_id || payload.orderId || '');
    const address = String(payload.address || '');
    const currency = String(payload.pay_currency || payload.currency || 'USDT').toUpperCase();
    const network = String(payload.network || 'TRC20').toUpperCase();
    const amount = Number(payload.pay_amount || payload.amount || payload.value || 0);

    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (!supabaseUrl || !serviceKey) {
      return res.status(200).send('ok');
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve user_id from order_id ("pukun_<uuid>_<network>") or from user_deposit_addresses
    let userId = '';
    let userEmail = '';
    const m = orderId.match(/^pukun_([0-9a-fA-F-]+)_/);
    if (m) {
      userId = m[1];
    } else if (address) {
      const { data: addrRow } = await supabase
        .from('user_deposit_addresses')
        .select('user_id, user_email')
        .eq('address', address)
        .maybeSingle();
      if (addrRow?.user_id) {
        userId = addrRow.user_id;
        userEmail = addrRow.user_email || '';
      }
    }

    if (!userId || amount <= 0) {
      return res.status(200).send('ok');
    }

    const isPaid = statusRaw === 'paid' || statusRaw === 'confirmed' || statusRaw === 'completed';
    const txStatus = isPaid ? 'COMPLETED' : 'PENDING';

    // Deduplicate by txid to avoid double-credit on webhook retries
    const { data: existingTx } = await supabase
      .from('transactions')
      .select('id, status')
      .eq('txid', txid)
      .maybeSingle();

    if (existingTx?.status === 'COMPLETED') {
      return res.status(200).send('ok');
    }

    if (existingTx?.id) {
      await supabase.from('transactions').update({ status: txStatus }).eq('id', existingTx.id);
    } else {
      await supabase.from('transactions').insert({
        user_id: userId,
        user_email: userEmail,
        env: 'REAL',
        type: 'DEPOSIT',
        asset: currency,
        network: `OxaPay ${network}`,
        amount,
        txid,
        address,
        status: txStatus,
      });
    }

    // Automatically credit user REAL wallet when Paid
    if (isPaid) {
      const { data: walletRow } = await supabase
        .from('wallets')
        .select('available, locked')
        .eq('user_id', userId)
        .eq('env', 'REAL')
        .eq('asset', currency)
        .maybeSingle();

      const nextAvailable = Number((Number(walletRow?.available || 0) + amount).toFixed(6));
      await supabase.from('wallets').upsert(
        {
          user_id: userId,
          env: 'REAL',
          asset: currency,
          available: nextAvailable,
          locked: Number(walletRow?.locked || 0),
        },
        { onConflict: 'user_id,env,asset' }
      );
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('OxaPay webhook error:', err);
    return res.status(500).send('Webhook error');
  }
}

