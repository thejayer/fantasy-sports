import { casinoUpstream } from "@/lib/casino";
import { getCasinoMember } from "@/lib/casino-member";
import { proxyCasino, type CasinoProxyDeps } from "@/lib/casino-proxy";

/**
 * Is the signed-in member a casino moderator? Asked of the casino itself on
 * every request (it owns the moderator list); /profile renders the "Mods only"
 * section for a mod and nothing otherwise. Any failure means "not a mod".
 * This is only about what to render: the casino re-checks moderator status on
 * every /casino/api/links/all and mod-removal call.
 */
export async function isCasinoMod(deps: Partial<CasinoProxyDeps> = {}): Promise<boolean> {
  try {
    const res = await proxyCasino(new Request("http://portal.internal/casino/api/links"), {
      getMember: getCasinoMember,
      timeoutMs: 5_000,
      ...deps,
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { mod?: unknown } | null;
    return body?.mod === true;
  } catch {
    return false;
  }
}

export function casinoAvailable(): boolean {
  return casinoUpstream() !== null;
}
