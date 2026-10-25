export const PRESENCE_WINDOW_MS = 30_000;

/** In-memory, per-game record of recently seen spectator clients. Client ids are opaque keys. */
export class SpectatorPresence {
  private readonly seen = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => number = Date.now) {}

  touch(gameId: string, clientId: string): void {
    const clients = this.prune(gameId) ?? new Map<string, number>();
    clients.set(clientId, this.now());
    this.seen.set(gameId, clients);
  }

  count(gameId: string): number {
    return this.prune(gameId)?.size ?? 0;
  }

  private prune(gameId: string): Map<string, number> | undefined {
    const clients = this.seen.get(gameId);
    if (!clients) {
      return undefined;
    }
    const cutoff = this.now() - PRESENCE_WINDOW_MS;
    for (const [id, at] of clients) {
      if (at < cutoff) {
        clients.delete(id);
      }
    }
    if (clients.size === 0) {
      this.seen.delete(gameId);
      return undefined;
    }
    return clients;
  }
}
