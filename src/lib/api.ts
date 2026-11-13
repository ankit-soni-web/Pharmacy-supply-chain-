import { UserRole } from '../types/platform.ts';
import { auth } from './firebase.ts';

let currentOperatorRole: UserRole = 'STATE_ADMIN';

export function setApiOperatorRole(role: UserRole) {
  currentOperatorRole = role;
}

export function getApiOperatorRole(): UserRole {
  return currentOperatorRole;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Operator-Role': currentOperatorRole,
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      headers.Authorization = `Bearer ${token}`;
    } catch {
      // Proceed without token if unavailable
    }
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}
