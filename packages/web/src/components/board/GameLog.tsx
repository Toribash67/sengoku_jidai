import type { SeatId } from "@sengoku-jidai/engine/client";
import { MAX_CHAT_LENGTH } from "@sengoku-jidai/shared";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { describeEventParts, eventSeat, type EventLookup, type LogPart } from "./eventLog.js";
import type { LogEntry } from "./gameLog.js";

/** How close (px) to the bottom still counts as "reading the latest" for auto-scroll. */
const STICK_SLACK = 24;

interface GameLogProps {
  entries: LogEntry[];
  lookup: EventLookup;
  viewerSeat: SeatId;
  /** Show the chat input (online human-vs-human games only). */
  chatEnabled: boolean;
  /** Send a chat line; rejects on failure so the draft is kept. */
  onSend: (text: string) => Promise<void>;
}

function Parts({ parts }: { parts: LogPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={index} className="log-name" data-seat={part.seat}>
            {part.text}
          </span>
        )
      )}
    </>
  );
}

/** The game log: events and chat in one oldest-first list that follows the newest entry while
 *  the player is scrolled to the bottom, with the chat input underneath. */
export function GameLog({ entries, lookup, viewerSeat, chatEnabled, onSend }: GameLogProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);
  const seenRef = useRef(entries.length);
  const [unread, setUnread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Follow new entries when at the bottom; otherwise flag an opponent's new chat line.
  useLayoutEffect(() => {
    const list = listRef.current;
    const fresh = entries.slice(seenRef.current);
    seenRef.current = entries.length;
    if (!list) {
      return;
    }
    if (stickRef.current) {
      list.scrollTop = list.scrollHeight;
    } else if (fresh.some((e) => e.kind === "chat" && e.message.seat !== viewerSeat)) {
      setUnread(true);
    }
  }, [entries, viewerSeat]);

  // Stay pinned to the newest line when the list itself resizes (window resize, the side panel
  // re-fitting, the chat input appearing).
  const hasList = entries.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        list.scrollTop = list.scrollHeight;
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasList]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) {
      return;
    }
    stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_SLACK;
    if (stickRef.current) {
      setUnread(false);
    }
  }

  function scrollToLatest() {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
    stickRef.current = true;
    setUnread(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) {
      return;
    }
    setSending(true);
    try {
      stickRef.current = true; // your own line always scrolls into view
      await onSend(text);
      setDraft("");
    } catch {
      // keep the draft; the caller surfaces the error
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel-section panel-log" aria-label="Game log">
      <h2>Log</h2>
      <div className="log-body">
        {entries.length === 0 ? (
          <p className="muted">No moves yet.</p>
        ) : (
          <ol className="event-log" ref={listRef} onScroll={handleScroll}>
            {entries.map((entry) => {
              switch (entry.kind) {
                case "round":
                  return (
                    <li key={entry.key} className="log-round">
                      <span className="log-round-label">Round {entry.event.round}</span>
                      <span className="log-round-note">
                        <Parts
                          parts={[
                            {
                              seat: entry.event.initiative,
                              text: lookup.seatName(entry.event.initiative)
                            },
                            " has initiative"
                          ]}
                        />
                      </span>
                    </li>
                  );
                case "chat":
                  return (
                    <li
                      key={entry.key}
                      className="log-chat"
                      data-seat={entry.message.seat}
                      data-mine={entry.message.seat === viewerSeat ? "true" : undefined}
                    >
                      <span className="log-name" data-seat={entry.message.seat}>
                        {lookup.seatName(entry.message.seat)}
                      </span>
                      <span className="log-chat-text">{entry.message.text}</span>
                    </li>
                  );
                case "event":
                  return (
                    <li
                      key={entry.key}
                      className="log-entry"
                      data-seat={eventSeat(entry.event) ?? undefined}
                    >
                      <Parts parts={describeEventParts(entry.event, lookup)} />
                    </li>
                  );
              }
            })}
          </ol>
        )}
        {unread ? (
          <button type="button" className="log-unread" onClick={scrollToLatest}>
            New message ↓
          </button>
        ) : null}
      </div>
      {chatEnabled ? (
        <form className="chat-form" onSubmit={(event) => void handleSubmit(event)}>
          <input
            type="text"
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Message your opponent…"
            aria-label="Chat message"
            autoComplete="off"
            enterKeyHint="send"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={sending || draft.trim().length === 0}>
            Send
          </button>
        </form>
      ) : null}
    </section>
  );
}
