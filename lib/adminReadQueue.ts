/** Per-mounted-console request coalescing. No response values are retained after a read settles. */
export function createAdminReadQueue() {
  const running = new Map<string, { controller: AbortController; promise: Promise<void> }>();

  const run = async (key: string, read: (signal: AbortSignal) => Promise<void>, { afterCurrent = false }: { afterCurrent?: boolean } = {}): Promise<void> => {
    const previous = running.get(key);
    if (previous) {
      if (!afterCurrent) return previous.promise;
      // Invalidations received during an older read require one new read after it settles.
      await previous.promise.catch(() => undefined);
      if (previous.controller.signal.aborted) return;
      return run(key, read);
    }
    const controller = new AbortController();
    const entry = { controller, promise: Promise.resolve() };
    const promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      return read(controller.signal);
    }).finally(() => { if (running.get(key) === entry) running.delete(key); });
    entry.promise = promise;
    running.set(key, entry);
    return promise;
  };

  return {
    run,
    abortAll: () => {
      running.forEach(entry => entry.controller.abort());
      running.clear();
    },
    abort: (key: string) => {
      running.get(key)?.controller.abort();
      running.delete(key);
    },
  };
}
