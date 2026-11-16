import { useEffect, useState } from 'react';
import { Shield, Key, Monitor, Bell, UserCheck } from 'lucide-react';
import { apiFetch } from '../api';
import { ExperienceLevel, UserProfile } from '../types';

interface Props {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
}

export function ProfileSecurityView({ user, onUserUpdated }: Props) {
  const [fullName, setFullName] = useState(user.full_name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [expLevel, setExpLevel] = useState<ExperienceLevel>(user.experience_level);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(user.notificationPrefs || {});

  const [currPass, setCurrPass] = useState('');
  const [newPass, setNewPass] = useState('');

  const [setup2faData, setSetup2faData] = useState<{ secret: string; currentCode: string } | null>(null);
  const [code2fa, setCode2fa] = useState('');

  const [kycDoc, setKycDoc] = useState('Pasaporte');
  const [kycCountry, setKycCountry] = useState('España');

  const [sessions, setSessions] = useState<Array<{ id: string; device: string; ip: string; active: number; created_at: number }>>([]);
  const [activity, setActivity] = useState<Array<{ id: string; action: string; details: string; created_at: number }>>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function loadAccountMeta() {
    try {
      const res = await apiFetch<{
        user: UserProfile;
        sessions: typeof sessions;
        activity: typeof activity;
        currentSessionId: string;
      }>('/api/auth/me');
      setSessions(res.sessions);
      setActivity(res.activity);
      setCurrentSessionId(res.currentSessionId);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadAccountMeta();
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, avatarUrl, experienceLevel: expLevel, notificationPrefs: notifPrefs }),
      });
      onUserUpdated(res.user);
      setFeedback({ type: 'ok', text: 'Perfil y nivel de experiencia actualizados.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando perfil' });
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currPass, newPassword: newPass }),
      });
      setCurrPass('');
      setNewPass('');
      setFeedback({ type: 'ok', text: 'Contraseña actualizada correctamente.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error cambiando contraseña' });
    }
  }

  async function handleSetup2fa() {
    const res = await apiFetch<{ secret: string; currentCode: string }>('/api/auth/2fa/setup', { method: 'POST' });
    setSetup2faData(res);
  }

  async function handleToggle2fa(enable: boolean) {
    setFeedback(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/2fa/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled: enable, code: code2fa }),
      });
      onUserUpdated(res.user);
      setSetup2faData(null);
      setCode2fa('');
      setFeedback({ type: 'ok', text: enable ? '2FA activado en tu cuenta.' : '2FA desactivado.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error con 2FA' });
    }
  }

  async function handleSubmitKyc(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch<{ user: UserProfile }>('/api/auth/kyc', {
      method: 'POST',
      body: JSON.stringify({ documentType: kycDoc, country: kycCountry }),
    });
    onUserUpdated(res.user);
    setFeedback({ type: 'ok', text: 'Verificación de identidad enviada a revisión.' });
  }

  async function handleRevokeSession(sid: string) {
    await apiFetch(`/api/auth/sessions/${sid}/revoke`, { method: 'POST' });
    loadAccountMeta();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-white">Perfil, Seguridad & Experiencia</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Rol actual: <span className="font-semibold text-blue-400">{user.role}</span> · Estado correo:{' '}
          {user.email_verified ? 'Verificado' : 'Pendiente'} · KYC: <span className="font-semibold text-white">{user.kyc_status}</span>
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded-xl px-4 py-3 text-xs border ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Profile & Experience Level */}
        <form onSubmit={handleSaveProfile} className="lg:col-span-6 rounded-xl border border-white/10 bg-[#111520] p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <UserCheck className="h-4 w-4 text-blue-400" />
            <span>Datos Personales y Nivel de Experiencia</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nombre completo</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">URL Foto de Perfil (opcional)</label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Nivel de Experiencia en la Interfaz</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'BEGINNER', title: 'Principiante', desc: 'Compra simple y guías' },
                { id: 'INTERMEDIATE', title: 'Intermedio', desc: 'Gráficos y bots' },
                { id: 'PRO', title: 'Profesional', desc: 'Terminal completo' },
              ].map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => setExpLevel(lvl.id as ExperienceLevel)}
                  className={`rounded-lg border p-2.5 text-left cursor-pointer ${
                    expLevel === lvl.id ? 'border-blue-500 bg-blue-500/15 text-white' : 'border-white/10 bg-[#090B10] text-slate-400'
                  }`}
                >
                  <div className="text-xs font-semibold">{lvl.title}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">{lvl.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold mb-2">
              <Bell className="h-3.5 w-3.5 text-blue-400" />
              <span>Preferencias de Notificaciones</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-300">
              {['signals', 'orders', 'bots', 'security', 'community'].map((k) => (
                <label key={k} className="flex items-center gap-2 rounded bg-[#090B10] px-2.5 py-1.5 border border-white/8">
                  <input
                    type="checkbox"
                    checked={notifPrefs[k] !== false}
                    onChange={(e) => setNotifPrefs({ ...notifPrefs, [k]: e.target.checked })}
                  />
                  <span className="capitalize">{k}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer">
            Guardar Perfil y Preferencias
          </button>
        </form>

        {/* 2FA & Password & KYC */}
        <div className="lg:col-span-6 space-y-5">
          <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Shield className="h-4 w-4 text-emerald-400" />
                <span>Autenticación de Dos Factores (2FA)</span>
              </div>
              <span className={`text-xs font-semibold ${user.two_factor_enabled ? 'text-emerald-400' : 'text-amber-400'}`}>
                {user.two_factor_enabled ? 'ACTIVO' : 'INACTIVO'}
              </span>
            </div>

            {user.two_factor_enabled === 0 ? (
              !setup2faData ? (
                <button
                  type="button"
                  onClick={handleSetup2fa}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  Configurar 2FA
                </button>
              ) : (
                <div className="space-y-2 rounded-lg bg-[#090B10] border border-white/10 p-3 text-xs">
                  <div className="text-slate-400">Clave secreta generada: <span className="font-mono text-white">{setup2faData.secret}</span></div>
                  <div className="text-blue-300 font-mono">Código temporal actual: {setup2faData.currentCode}</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={code2fa}
                      onChange={(e) => setCode2fa(e.target.value)}
                      placeholder="Ingresa los 6 dígitos"
                      className="flex-1 rounded border border-white/10 bg-[#111520] px-3 py-1.5 font-mono text-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleToggle2fa(true)}
                      className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white cursor-pointer"
                    >
                      Activar
                    </button>
                  </div>
                </div>
              )
            ) : (
              <button
                type="button"
                onClick={() => handleToggle2fa(false)}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-300 cursor-pointer"
              >
                Desactivar 2FA
              </button>
            )}
          </div>

          <form onSubmit={handleChangePassword} className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Key className="h-4 w-4 text-blue-400" />
              <span>Cambiar Contraseña</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="password"
                required
                value={currPass}
                onChange={(e) => setCurrPass(e.target.value)}
                placeholder="Contraseña actual"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
              />
              <input
                type="password"
                required
                minLength={8}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Nueva contraseña (8+ caracteres)"
                className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
              />
            </div>
            <button type="submit" className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15 cursor-pointer">
              Actualizar Contraseña
            </button>
          </form>

          {user.kyc_status !== 'VERIFIED' && (
            <form onSubmit={handleSubmitKyc} className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
              <div className="text-sm font-bold text-white">Verificación de Identidad (KYC para modo REAL)</div>
              <div className="grid grid-cols-2 gap-3">
                <select value={kycDoc} onChange={(e) => setKycDoc(e.target.value)} className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white">
                  <option>Pasaporte</option>
                  <option>Documento Nacional</option>
                  <option>Licencia de Conducir</option>
                </select>
                <input
                  type="text"
                  value={kycCountry}
                  onChange={(e) => setKycCountry(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white"
                />
              </div>
              <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white cursor-pointer">
                Enviar Solicitud KYC
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Sessions & Activity Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Monitor className="h-4 w-4 text-blue-400" />
            <span>Gestión de Sesiones</span>
          </div>
          <div className="divide-y divide-white/6 text-xs">
            {sessions.map((s) => (
              <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-white truncate">{s.device}</div>
                  <div className="text-slate-500">
                    IP {s.ip} · {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>
                {s.id === currentSessionId ? (
                  <span className="text-emerald-400 font-semibold shrink-0">Sesión actual</span>
                ) : s.active ? (
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.id)}
                    className="text-red-400 hover:underline shrink-0 cursor-pointer"
                  >
                    Cerrar
                  </button>
                ) : (
                  <span className="text-slate-500 shrink-0">Revocada</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111520] p-5 space-y-3">
          <div className="text-sm font-bold text-white">Historial de Actividad de Seguridad</div>
          <div className="divide-y divide-white/6 text-xs max-h-64 overflow-y-auto">
            {activity.map((a) => (
              <div key={a.id} className="py-2">
                <div className="flex justify-between">
                  <span className="font-semibold text-blue-300">{a.action}</span>
                  <span className="text-slate-500">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <div className="text-slate-400 mt-0.5">{a.details}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
