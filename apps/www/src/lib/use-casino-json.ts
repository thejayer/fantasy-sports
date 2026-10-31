import { useCallback, useEffect, useState } from "react";

import { CasinoApiError, casinoApi } from "@/lib/casino-api-client";

const messageOf = (err: unknown, fallback: string) => (err instanceof CasinoApiError ? err.message : fallback);

/** Load one /casino/api/* JSON document, with a reload for after a change. */
export function useCasinoJson<T>(path: string, failMessage: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });

  useEffect(() => {
    let alive = true;
    casinoApi<T>(path).then(
      (data) => {
        if (alive) setState({ data, error: null });
      },
      (err: unknown) => {
        if (alive) setState((s) => ({ ...s, error: messageOf(err, failMessage) }));
      },
    );
    return () => {
      alive = false;
    };
  }, [path, failMessage]);

  const reload = useCallback(async () => {
    try {
      setState({ data: await casinoApi<T>(path), error: null });
    } catch (err) {
      setState((s) => ({ ...s, error: messageOf(err, failMessage) }));
    }
  }, [path, failMessage]);

  const setError = useCallback((error: string | null) => setState((s) => ({ ...s, error })), []);
  return { data: state.data, error: state.error, reload, setError };
}
