export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/**
 * Thin fetch wrapper for talking to the Eon Rover API from the browser.
 * Always sends cookies and the CSRF header the API requires for mutations.
 */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Eonrover-Client': '1',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const errorBody = body as { error?: string; code?: string; details?: unknown };
    throw new ApiError(errorBody.error || 'Request failed', res.status, body, errorBody.code);
  }
  return body as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export function apiPost<T = unknown>(path: string, data?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
}

export function apiPatch<T = unknown>(path: string, data?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
