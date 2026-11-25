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

