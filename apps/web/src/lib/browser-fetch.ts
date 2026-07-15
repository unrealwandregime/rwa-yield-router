"use client";

export const CSRF_COOKIE_NAMES = ["__Host-rwa-csrf", "rwa-csrf"] as const;

const mutatingMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const candidate = part.trim();
    if (candidate.startsWith(prefix)) return decodeURIComponent(candidate.slice(prefix.length));
  }
  return null;
}

export function browserFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!mutatingMethods.has(method)) return fetch(input, init);

  const token = CSRF_COOKIE_NAMES.map(readCookie).find((value) => value !== null);
  if (token === undefined)
    return Promise.reject(new Error("Browser security token is unavailable"));
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  headers.set("x-rwa-csrf-token", token);
  return fetch(input, { ...init, headers });
}
