import { useEffect, useRef } from "react";

/** True when a newer opponent chat message arrived while the tab is hidden. `null` means the chat
 *  history isn't loaded yet, so the first load only sets the baseline (no alert for old lines). */
export function shouldChatAlert(
  prevLatestId: number | null,
  nextLatestId: number | null,
  hidden: boolean
): boolean {
  return hidden && prevLatestId !== null && nextLatestId !== null && nextLatestId > prevLatestId;
}

/** The attention title shown on a backgrounded tab when the opponent sends a chat message. */
export function chatAlertTitle(baseTitle: string): string {
  return `● New message — ${baseTitle}`;
}

/** Flash the tab title when the opponent chats while the tab is backgrounded; restore it when the
 *  tab regains focus. Mirrors `useTurnAlert`. `latestOpponentId` is the newest opponent message
 *  id (0 when none), or null while the history is loading. */
export function useChatAlert(latestOpponentId: number | null): void {
  const baseTitleRef = useRef<string>(typeof document !== "undefined" ? document.title : "");
  const prevRef = useRef<number | null>(latestOpponentId);
  const alertingRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const restore = () => {
      if (alertingRef.current) {
        alertingRef.current = false;
        document.title = baseTitleRef.current;
      }
    };
    const onVisibility = () => {
      if (!document.hidden) {
        restore();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      restore();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const prev = prevRef.current;
    prevRef.current = latestOpponentId;
    if (shouldChatAlert(prev, latestOpponentId, document.hidden)) {
      alertingRef.current = true;
      document.title = chatAlertTitle(baseTitleRef.current);
    }
  }, [latestOpponentId]);
}
