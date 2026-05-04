/**
 * fetch con timeout duro vía AbortController.
 * Si el servidor no responde en `timeoutMs`, aborta y rechaza con LLMError-like message.
 *
 * Uso:
 *   const res = await fetchWithTimeout(url, { timeoutMs: 10_000, headers });
 */
export interface FetchWithTimeoutOpts extends RequestInit {
  timeoutMs: number;
}

export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOpts,
): Promise<Response> {
  const { timeoutMs, signal: externalSignal, ...rest } = opts;
  const controller = new AbortController();

  // Si el caller también pasó un signal, conectamos los dos abort sources.
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`fetch timeout after ${timeoutMs}ms: ${url}`));
  }, timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
