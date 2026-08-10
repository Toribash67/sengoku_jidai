/** Await `fn`, retrying up to `attempts` total on rejection with a fixed `delayMs` backoff
 *  between tries, then rethrowing the last error. Bounded on purpose: a deterministic failure
 *  exhausts the attempts rather than looping forever. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.attempts && opts.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }
  }
  throw lastError;
}
