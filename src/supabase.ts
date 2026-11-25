import { createClient } from '@supabase/supabase-js';
import type { UserProfile, UserRole, ExperienceLevel } from './types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('tu-proyecto') &&
    !supabaseAnonKey.includes('tu_clave')
  );
};

export const supabase = createClient(
  isSupabaseConfigured() ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured() ? supabaseAnonKey : 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export const SUPERADMIN_EMAILS = ['horaciowalterortiz@gmail.com'];

export function isSuperadminEmail(email?: string | null): boolean {
  if (!email) return false;
  return SUPERADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export function mapSupabaseUserToProfile(authUser: any, profileData?: any): UserProfile {
  const metadata = authUser?.user_metadata || {};
  const email = authUser.email || '';
  const resolvedRole: UserRole = isSuperadminEmail(email)
    ? 'SUPERADMIN'
    : ((profileData?.role || metadata.role || 'USER') as UserRole);

  return {
    id: authUser.id,
    email,
    full_name: profileData?.full_name || metadata.full_name || email.split('@')[0] || 'Trader',
    avatar_url: profileData?.avatar_url || metadata.avatar_url || '',
    role: resolvedRole,
    experience_level: (profileData?.experience_level || metadata.experience_level || 'BEGINNER') as ExperienceLevel,
    two_factor_enabled: profileData?.two_factor_enabled ? 1 : 0,
    email_verified: authUser.email_confirmed_at ? 1 : 1, // assume 1 if confirmed or demo
    kyc_status: isSuperadminEmail(email) ? 'VERIFIED' : (profileData?.kyc_status || 'UNVERIFIED'),
    referral_code: profileData?.referral_code || metadata.referral_code || `PUKUN-${authUser.id.slice(0, 6).toUpperCase()}`,
    favorites: profileData?.favorites || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    notificationPrefs: profileData?.notification_prefs || {
      signals: true,
      orders: true,
      bots: true,
      security: true,
      community: true,
    },
    status: profileData?.status || 'ACTIVE',
    created_at: Math.floor(new Date(authUser.created_at || Date.now()).getTime() / 1000),
  };
}

export async function fetchProfile(userId: string): Promise<any | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Error fetching profile from Supabase:', error.message);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function createDemoWallets(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const initialWallets = [
      { user_id: userId, env: 'DEMO', asset: 'USDT', available: 10000, locked: 0 },
      { user_id: userId, env: 'DEMO', asset: 'BTC', available: 0.25, locked: 0 },
      { user_id: userId, env: 'DEMO', asset: 'ETH', available: 2.5, locked: 0 },
      { user_id: userId, env: 'DEMO', asset: 'SOL', available: 15, locked: 0 },
      { user_id: userId, env: 'DEMO', asset: 'CAIX', available: 500, locked: 0 },
    ];
    await supabase.from('wallets').upsert(initialWallets, { onConflict: 'user_id,env,asset' });
  } catch (err) {
    console.warn('Could not seed demo wallets in Supabase:', err);
  }
}

export async function signUpWithSupabase(
  email: string,
  pass: string,
  fullName: string,
  referralCode?: string
): Promise<{ user: UserProfile; sessionToken: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase no está configurado. Revisa tus variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel.');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: pass,
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      data: {
        full_name: fullName,
        referral_code: referralCode || `PUKUN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      throw new Error(
        'Tu correo aún figura como no confirmado en Supabase. Confírmalo desde tu email o en Supabase Auth -> Users.'
      );
    }
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error('No se pudo crear el usuario.');
  }

  // If Supabase requires email confirmation and no session was returned yet
  if (!data.session) {
    throw new Error(
      'Cuenta creada. Revisa tu correo y haz clic en el enlace de confirmación (o desactiva "Confirm email" en Supabase para entrar al instante).'
    );
  }

  // Create or upsert profile in public.profiles if table exists
  const assignedRole: UserRole = isSuperadminEmail(data.user.email) ? 'SUPERADMIN' : 'USER';
  try {
    await supabase.from('profiles').upsert({
      id: data.user.id,
      email: data.user.email,
      full_name: fullName,
      referral_code: referralCode || `PUKUN-${data.user.id.slice(0, 6).toUpperCase()}`,
      role: assignedRole,
      status: 'ACTIVE',
    });
  } catch (e) {
    console.warn('Profile table upsert skipped:', e);
  }

  // Seed demo wallets for user
  await createDemoWallets(data.user.id);

  const profile = mapSupabaseUserToProfile(data.user, { full_name: fullName });
  const token = data.session?.access_token || `sb_token_${data.user.id}`;
  return { user: profile, sessionToken: token };
}

export async function signInWithSupabase(
  email: string,
  pass: string
): Promise<{ user: UserProfile; sessionToken: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase no está configurado. Revisa tus variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pass,
  });

  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      throw new Error(
        'Tu correo aún figura como no confirmado en Supabase. Confírmalo desde tu email o en Supabase Auth -> Users.'
      );
    }
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error('Usuario no encontrado.');
  }

  const dbProfile = await fetchProfile(data.user.id);
  const profile = mapSupabaseUserToProfile(data.user, dbProfile);
  const token = data.session?.access_token || `sb_token_${data.user.id}`;
  return { user: profile, sessionToken: token };
}

export async function getCurrentSupabaseUser(): Promise<UserProfile | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const dbProfile = await fetchProfile(session.user.id);
    return mapSupabaseUserToProfile(session.user, dbProfile);
  } catch {
    return null;
  }
}

// ============================================================================
// SUPERADMIN REAL SUPABASE MANAGEMENT (USERS, BALANCES, DEPOSITS, MASTER WALLETS)
// ============================================================================

export interface AdminSupabaseUserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  kyc_status: string;
  status: string;
  referral_code?: string;
  created_at?: string;
  wallets: Array<{ env: string; asset: string; available: number; locked: number }>;
}

export interface AdminSupabaseTxRow {
  id: string;
  user_id: string;
  user_email?: string;
  env: string;
  type: string;
  asset: string;
  network: string;
  amount: number;
  txid: string;
  address: string;
  status: string;
  created_at: string;
}

export interface DepositGatewayConfig {
  provider: 'DIRECT_MASTER' | 'OXAPAY' | 'CRYPTOMUS' | 'NOWPAYMENTS';
  masterAddresses: Record<string, string>;
  oxapayMerchantNote?: string;
}

export const DEFAULT_DEPOSIT_GATEWAY_CONFIG: DepositGatewayConfig = {
  provider: 'DIRECT_MASTER',
  masterAddresses: {
    'Tron (TRC-20)': '',
    'BNB Smart Chain': '',
    'Ethereum (ERC-20)': '',
    Polygon: '',
    Arbitrum: '',
    Bitcoin: '',
    Solana: '',
  },
};

const DEPOSIT_CFG_STORAGE = 'pukun_master_deposit_config_v1';

export async function fetchDepositGatewayConfig(): Promise<DepositGatewayConfig> {
  let localCfg: DepositGatewayConfig | null = null;
  try {
    const raw = localStorage.getItem(DEPOSIT_CFG_STORAGE);
    if (raw) localCfg = JSON.parse(raw) as DepositGatewayConfig;
  } catch {
    // ignore
  }
  if (!isSupabaseConfigured()) return localCfg || DEFAULT_DEPOSIT_GATEWAY_CONFIG;
  try {
    const { data } = await supabase
      .from('platform_settings')
      .select('value_json')
      .eq('key', 'deposit_gateway')
      .maybeSingle();
    if (data?.value_json) {
      const merged: DepositGatewayConfig = {
        ...DEFAULT_DEPOSIT_GATEWAY_CONFIG,
        ...(data.value_json as Partial<DepositGatewayConfig>),
        masterAddresses: {
          ...DEFAULT_DEPOSIT_GATEWAY_CONFIG.masterAddresses,
          ...((data.value_json as Partial<DepositGatewayConfig>).masterAddresses || {}),
        },
      };
      localStorage.setItem(DEPOSIT_CFG_STORAGE, JSON.stringify(merged));
      return merged;
    }
  } catch {
    // table may not exist yet
  }
  return localCfg || DEFAULT_DEPOSIT_GATEWAY_CONFIG;
}

export async function saveDepositGatewayConfig(cfg: DepositGatewayConfig): Promise<void> {
  try {
    localStorage.setItem(DEPOSIT_CFG_STORAGE, JSON.stringify(cfg));
  } catch {
    // ignore
  }
  if (!isSupabaseConfigured()) return;
  await supabase.from('platform_settings').upsert({
    key: 'deposit_gateway',
    value_json: cfg,
    updated_at: new Date().toISOString(),
  });
}

export async function adminFetchAllUsersAndTxs(): Promise<{
  users: AdminSupabaseUserRow[];
  transactions: AdminSupabaseTxRow[];
  warning?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { users: [], transactions: [], warning: 'Supabase no configurado.' };
  }

  const [{ data: profiles, error: pErr }, { data: wallets }, { data: txs }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('wallets').select('*'),
    supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(100),
  ]);

  if (pErr) {
    return {
      users: [],
      transactions: [],
      warning: `Permiso/Tabla Supabase: ${pErr.message}. Ejecuta el SQL de Superadmin en Supabase SQL Editor.`,
    };
  }

  const emailById = new Map<string, string>();
  const users: AdminSupabaseUserRow[] = (profiles || []).map((p: any) => {
    emailById.set(p.id, p.email || '');
    const userWallets = (wallets || [])
      .filter((w: any) => w.user_id === p.id)
      .map((w: any) => ({
        env: w.env || 'DEMO',
        asset: w.asset || 'USDT',
        available: Number(w.available || 0),
        locked: Number(w.locked || 0),
      }));
    return {
      id: p.id,
      email: p.email || '',
      full_name: p.full_name || 'Sin nombre',
      role: (isSuperadminEmail(p.email) ? 'SUPERADMIN' : p.role || 'USER') as UserRole,
      kyc_status: p.kyc_status || 'UNVERIFIED',
      status: p.status || 'ACTIVE',
      referral_code: p.referral_code || '',
      created_at: p.created_at,
      wallets: userWallets,
    };
  });

  const transactions: AdminSupabaseTxRow[] = (txs || []).map((t: any) => ({
    id: t.id,
    user_id: t.user_id,
    user_email: emailById.get(t.user_id) || t.user_email || t.user_id,
    env: t.env || 'REAL',
    type: t.type || 'DEPOSIT',
    asset: t.asset || 'USDT',
    network: t.network || 'Tron (TRC-20)',
    amount: Number(t.amount || 0),
    txid: t.txid || '',
    address: t.address || '',
    status: t.status || 'PENDING',
    created_at: t.created_at || new Date().toISOString(),
  }));

  return { users, transactions };
}

export async function adminAdjustUserBalance(params: {
  userId: string;
  env: 'DEMO' | 'REAL';
  asset: string;
  mode: 'ADD' | 'SUB' | 'SET';
  amount: number;
}): Promise<number> {
  const { userId, env, asset, mode, amount } = params;
  if (!isSupabaseConfigured()) throw new Error('Supabase no configurado.');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Monto inválido.');

  const { data: existing } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('env', env)
    .eq('asset', asset)
    .maybeSingle();

  const current = Number(existing?.available || 0);
  let nextAvailable = current;
  if (mode === 'ADD') nextAvailable = current + amount;
  else if (mode === 'SUB') nextAvailable = Math.max(0, current - amount);
  else nextAvailable = amount;

  nextAvailable = Number(nextAvailable.toFixed(6));

  const { error } = await supabase.from('wallets').upsert(
    {
      user_id: userId,
      env,
      asset,
      available: nextAvailable,
      locked: Number(existing?.locked || 0),
    },
    { onConflict: 'user_id,env,asset' }
  );

  if (error) throw new Error(error.message);
  return nextAvailable;
}

export async function adminReviewTransaction(tx: AdminSupabaseTxRow, action: 'APPROVE' | 'REJECT'): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase no configurado.');
  const nextStatus = action === 'APPROVE' ? 'COMPLETED' : 'REJECTED';

  const { error } = await supabase.from('transactions').update({ status: nextStatus }).eq('id', tx.id);
  if (error) throw new Error(error.message);

  // If approving a DEPOSIT, credit user's balance automatically
  if (action === 'APPROVE' && tx.type === 'DEPOSIT') {
    await adminAdjustUserBalance({
      userId: tx.user_id,
      env: tx.env === 'REAL' ? 'REAL' : 'DEMO',
      asset: tx.asset,
      mode: 'ADD',
      amount: tx.amount,
    });
  }
  // If rejecting a WITHDRAW, refund user's balance automatically
  if (action === 'REJECT' && tx.type === 'WITHDRAW') {
    await adminAdjustUserBalance({
      userId: tx.user_id,
      env: tx.env === 'REAL' ? 'REAL' : 'DEMO',
      asset: tx.asset,
      mode: 'ADD',
      amount: tx.amount,
    });
  }
}

export async function recordUserTxInSupabase(params: {
  env: 'DEMO' | 'REAL';
  type: 'DEPOSIT' | 'WITHDRAW';
  asset: string;
  network: string;
  amount: number;
  txid: string;
  address: string;
  status: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    await supabase.from('transactions').insert({
      user_id: session.user.id,
      user_email: session.user.email || '',
      env: params.env,
      type: params.type,
      asset: params.asset,
      network: params.network,
      amount: params.amount,
      txid: params.txid,
      address: params.address,
      status: params.status,
    });
  } catch {
    // ignore if transactions table is not created yet
  }
}

