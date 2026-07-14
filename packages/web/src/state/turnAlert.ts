import { useEffect, useRef } from "react";

/** True only when the turn just flipped to the viewer (false -> true) while the tab is hidden —
 *  the one moment we want to pull the player back to a backgrounded tab. Pure + unit-tested; the
 *  hook below owns the DOM side of it. */
export function shouldAlert(
  prevViewerTurn: boolean,
  nextViewerTurn: boolean,
  hidden: boolean
): boolean {
  return hidden && nextViewerTurn && !prevViewerTurn;
}

/** The attention title shown on a backgrounded tab when it becomes the viewer's move. */
export function alertTitle(baseTitle: string): string {
  return `● Your move — ${baseTitle}`;
}

/** Flash the browser tab's title when it becomes the viewer's turn while the tab is backgrounded,
 *  and restore it when the tab regains focus (or the component unmounts). No-op while the tab is
 *  visible — you can already see the board. */
export function useTurnAlert(isViewerTurn: boolean): void {
  const baseTitleRef = useRef<string>(typeof document !== "undefined" ? document.title : "");
  const prevTurnRef = useRef<boolean>(isViewerTurn);
  const alertingRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const restore = () => {
      alertingRef.current = false;
      document.title = baseTitleRef.current;
    };
    const onVisibility = () => {
      if (!document.hidden && alertingRef.current) {
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
    const prev = prevTurnRef.current;
    prevTurnRef.current = isViewerTurn;
    if (shouldAlert(prev, isViewerTurn, document.hidden)) {
      alertingRef.current = true;
      document.title = alertTitle(baseTitleRef.current);
    } else if (alertingRef.current && !isViewerTurn) {
      // Turn moved on before the player came back — drop the stale alert.
      alertingRef.current = false;
      document.title = baseTitleRef.current;
    }
  }, [isViewerTurn]);
}
