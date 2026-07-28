/**
 * Next.js Data Cache tags for hub snapshot JSON.
 *
 * `readJson` in `lib/data.ts` tags every store read with `SJ_SNAPSHOTS_CACHE_TAG`.
 * `POST /api/revalidate` (Bearer `SJ_REVALIDATE_SECRET`) calls
 * `revalidateTag(tag, "max")` so a sync/refresh can mark entries stale
 * (stale-while-revalidate) without waiting for TTL.
 *
 * Cache is still per Cloud Run instance — TTL (`SJ_CACHE_TTL_MS`) remains the
 * multi-instance staleness bound. No Redis/Memorystore.
 */
export const SJ_SNAPSHOTS_CACHE_TAG = "sj-snapshots";
