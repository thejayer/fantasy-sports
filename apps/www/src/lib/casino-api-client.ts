/** Browser calls to this site's own /casino/api/* (same origin; the session cookie rides along). */

export class CasinoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CasinoApiError";
  }
}

export async function casinoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(`/casino/${path}`, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: init.body ? { "content-type": "application/json" } : undefined,
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new CasinoApiError(data.error ?? "That didn't work. Try again.", res.status);
    return data;
  } catch (err) {
    if (err instanceof CasinoApiError) throw err;
    throw new CasinoApiError("Couldn't reach the casino. Try again.", 0);
  } finally {
    window.clearTimeout(timer);
  }
}
