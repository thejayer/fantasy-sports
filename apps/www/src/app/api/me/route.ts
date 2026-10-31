import { getMe } from "@/lib/me";

/**
 * Who is signed in, for the account menu on www pages and in the casino.
 * Public path (a signed-out visitor just gets { signedIn: false }), never
 * cached, and never returns an email or an id.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await getMe(), {
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
