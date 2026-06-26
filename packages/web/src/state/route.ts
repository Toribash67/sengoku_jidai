import { useEffect, useState } from "react";

export type Route = { kind: "create" } | { kind: "game"; gameId: string; token: string };

const GAME_PATH = /^\/g\/([^/]+)\/?$/;

/** Parse a location into a route. The seat token rides in the URL fragment so it
 *  never reaches the server. Pure — takes the location parts as an argument. */
export function parseRoute(loc: { pathname: string; hash: string }): Route {
  const match = GAME_PATH.exec(loc.pathname);
  if (!match) {
    return { kind: "create" };
  }
  const token = loc.hash.startsWith("#") ? loc.hash.slice(1) : "";
  return { kind: "game", gameId: decodeURIComponent(match[1]!), token };
}

/** Relative seat URL: game id in the path, secret token in the fragment. */
export function gameUrl(gameId: string, token: string): string {
  return `/g/${encodeURIComponent(gameId)}#${token}`;
}

/** Absolute seat URL for sharing, built from an origin (e.g. window.location.origin). */
export function inviteUrl(origin: string, gameId: string, token: string): string {
  return `${origin}${gameUrl(gameId, token)}`;
}

/** Client-side navigation: push the path, then notify listeners (pushState does not
 *  fire popstate). */
export function navigateTo(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Track the current route, re-rendering on back/forward and navigateTo. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location));
  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return route;
}
