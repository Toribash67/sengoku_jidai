import type { PlayerGameEvent } from "@sengoku-jidai/engine/client";
import type { ChatMessage } from "@sengoku-jidai/shared";

/** A game event tagged with the revision it was produced at (for interleaving chat). */
export interface LoggedEvent {
  revision: number;
  event: PlayerGameEvent;
}

export type LogEntry =
  | { kind: "event"; key: string; event: PlayerGameEvent }
  | { kind: "round"; key: string; event: Extract<PlayerGameEvent, { type: "recalled" }> }
  | { kind: "chat"; key: string; message: ChatMessage };

/** Merge the chronological event log and chat into one oldest-first list. A chat line sent at
 *  revision R sits after every event up to R (it was typed after seeing them) and before the
 *  first event of a later revision. A new round (`recalled`) becomes a divider entry. */
export function buildLogEntries(
  events: readonly LoggedEvent[],
  chat: readonly ChatMessage[]
): LogEntry[] {
  const messages = [...chat].sort((a, b) => a.revision - b.revision || a.id - b.id);
  const entries: LogEntry[] = [];
  let next = 0;
  const flushChatBefore = (revision: number) => {
    while (next < messages.length && messages[next]!.revision < revision) {
      const message = messages[next]!;
      entries.push({ kind: "chat", key: `c${message.id}`, message });
      next += 1;
    }
  };
  events.forEach(({ revision, event }, index) => {
    flushChatBefore(revision);
    entries.push(
      event.type === "recalled"
        ? { kind: "round", key: `e${index}`, event }
        : { kind: "event", key: `e${index}`, event }
    );
  });
  flushChatBefore(Number.POSITIVE_INFINITY);
  return entries;
}

/** Append chat messages not already held (by id), keeping id order. */
export function mergeChat(held: ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const ids = new Set(held.map((m) => m.id));
  const fresh = incoming.filter((m) => !ids.has(m.id));
  return fresh.length === 0 ? held : [...held, ...fresh].sort((a, b) => a.id - b.id);
}
