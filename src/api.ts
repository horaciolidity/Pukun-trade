const TOKEN_STORAGE_KEY = 'cryptoai_jwt_token';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setStoredToken(token: string) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || `Error HTTP ${res.status}`);
  }
  const data = await res.json();
  return data as T;
}

export function formatCurrency(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPrice(price: number): string {
  if (price >= 1000) return formatCurrency(price, 2);
  if (price >= 10) return formatCurrency(price, 2);
  if (price >= 1) return formatCurrency(price, 4);
  return formatCurrency(price, 4);
}
