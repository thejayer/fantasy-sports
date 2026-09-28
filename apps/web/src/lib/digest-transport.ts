/**
 * Outbound digest delivery (roadmap 7.7 transport).
 *
 * Generation is pure (`digest.ts`); this only posts a pre-formatted message.
 * Discord webhook is the highest-value channel for this group — email can
 * share the same `deliverDigest` shape later.
 *
 * Idempotency: callers should key deliveries by league-season-period and skip
 * when already sent (tracked in feed.json sidecar or a small deliveries file).
 */

export type DigestDeliveryResult =
  | { ok: true; channel: "discord"; status: number }
  | { ok: false; channel: "discord"; error: string; status?: number }
  | { ok: false; channel: "none"; error: string };

export function discordWebhookConfigured(): boolean {
  return Boolean(process.env.SJ_DISCORD_WEBHOOK_URL?.trim());
}

/**
 * POST a message to the configured Discord webhook. No-ops with a clear
 * error when the env var is unset — generation/UI must still work offline.
 */
export async function deliverDigestToDiscord(
  content: string,
  opts?: { webhookUrl?: string; fetchImpl?: typeof fetch },
): Promise<DigestDeliveryResult> {
  const url = (opts?.webhookUrl ?? process.env.SJ_DISCORD_WEBHOOK_URL ?? "").trim();
  if (!url) {
    return {
      ok: false,
      channel: "none",
      error: "SJ_DISCORD_WEBHOOK_URL is not set",
    };
  }
  // Discord hard limit is 2000; keep a margin for markdown.
  const text = content.length > 1900 ? `${content.slice(0, 1890)}…` : content;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        channel: "discord",
        status: res.status,
        error: detail || `Discord webhook returned ${res.status}`,
      };
    }
    return { ok: true, channel: "discord", status: res.status };
  } catch (err) {
    return {
      ok: false,
      channel: "discord",
      error: err instanceof Error ? err.message : "webhook request failed",
    };
  }
}
