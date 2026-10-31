import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during server render and hydration, true once running in the browser (for portals). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
