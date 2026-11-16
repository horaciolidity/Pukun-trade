import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'crypto-ai-exchange-dev-jwt-secret-key';

export type UserRole = 'USER' | 'MODERATOR' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: string;
  sessionId: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signAuthToken(payload: AuthUser): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyAuthToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Sesión requerida. Inicia sesión para continuar.' });
    return;
  }

  const decoded = verifyAuthToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Token de sesión inválido o expirado.' });
    return;
  }

  const user = db.prepare(`SELECT id, email, full_name, role, status FROM users WHERE id = ?`).get(decoded.id) as
    | { id: string; email: string; full_name: string; role: UserRole; status: string }
    | undefined;

  if (!user) {
    res.status(401).json({ error: 'Usuario no encontrado.' });
    return;
  }

  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: `Cuenta ${user.status.toLowerCase()}. Contacta a soporte.` });
    return;
  }

  const session = db.prepare(`SELECT active FROM sessions WHERE id = ? AND user_id = ?`).get(decoded.sessionId, user.id) as
    | { active: number }
    | undefined;

  if (session && session.active === 0) {
    res.status(401).json({ error: 'Esta sesión ha sido cerrada remotamente.' });
    return;
  }

  req.user = { ...user, sessionId: decoded.sessionId };
  next();
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  USER: 1,
  SUPPORT: 2,
  MODERATOR: 3,
  ADMIN: 4,
  SUPERADMIN: 5,
};

export function requireMinRole(minRole: UserRole) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    if (ROLE_HIERARCHY[req.user.role] < ROLE_HIERARCHY[minRole]) {
      res.status(403).json({ error: `Acceso denegado. Se requiere rol ${minRole} o superior.` });
      return;
    }
    next();
  };
}

export function logActivity(userId: string, action: string, details: string, ip = '127.0.0.1') {
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, action, details, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`act_${crypto.randomUUID().slice(0, 12)}`, userId, action, details, ip, Date.now());
}

export function logAudit(adminId: string, adminEmail: string, action: string, target: string, details: string) {
  db.prepare(`
    INSERT INTO audit_logs (id, admin_id, admin_email, action, target, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`aud_${crypto.randomUUID().slice(0, 12)}`, adminId, adminEmail, action, target, details, Date.now());
}

export function createNotification(
  userId: string,
  category: 'SIGNALS' | 'ORDERS' | 'BOTS' | 'LIQUIDATION' | 'WALLET' | 'REFERRALS' | 'SECURITY' | 'COMMUNITY',
  title: string,
  message: string
) {
  const id = `ntf_${crypto.randomUUID().slice(0, 12)}`;
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, category, title, message, createdAt);
  return { id, user_id: userId, category, title, message, read: 0, created_at: createdAt };
}

export function generateTwoFactorCode(secret: string): string {
  const step = Math.floor(Date.now() / 30000);
  const hash = crypto.createHmac('sha256', secret).update(String(step)).digest('hex');
  const num = parseInt(hash.slice(0, 8), 16) % 1000000;
  return String(num).padStart(6, '0');
}

export function verifyTwoFactorCode(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  const currentStep = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    const hash = crypto.createHmac('sha256', secret).update(String(currentStep + offset)).digest('hex');
    const expected = String(parseInt(hash.slice(0, 8), 16) % 1000000).padStart(6, '0');
    if (expected === code.trim()) return true;
  }
  return false;
}
