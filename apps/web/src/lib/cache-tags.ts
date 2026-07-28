/**
 * Next.js Data Cache tags for hub snapshot JSON.
 *
 * `readJson` in `lib/data.ts` tags every store read with `SJ_SNAPSHOTS_CACHE_TAG`.
 * `POST /api/revalidate` (Bearer `SJ_REVALIDATE_SECRET`) calls `revalidateTag`
 * so a sync/refresh can drop stale entries without waiting for TTL.
 *
 * Cache is still per Cloud Run instance — TTL (`SJ_CACHE_TTL_MS`) remains the
 * multi-instance staleness bound. No Redis/Memorystore.
 */
export const SJ_SNAPSHOTS_CACHE_TAG = "sj-snapshots";
