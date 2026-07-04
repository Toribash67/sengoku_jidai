import { useEffect, useState } from "react";

export type Route =
  | { kind: "create"; map: string | null }
  | { kind: "game"; gameId: string; token: string }
  | { kind: "maps" }
  | { kind: "editor"; mapId: string | null };

const GAME_PATH = /^\/g\/([^/]+)\/?$/;
const MAPS_PATH = /^\/maps\/?$/;
const EDITOR_NEW_PATH = /^\/maps\/new\/?$/;
const EDITOR_EDIT_PATH = /^\/maps\/([^/]+)\/edit\/?$/;

/** Parse a location into a route. The seat token rides in the URL fragment so it
 *  never reaches the server. Pure — takes the location parts as an argument. */
export function parseRoute(loc: { pathname: string; hash: string; search: string }): Route {
  const game = GAME_PATH.exec(loc.pathname);
  if (game) {
    const token = loc.hash.startsWith("#") ? loc.hash.slice(1) : "";
    return { kind: "game", gameId: decodeURIComponent(game[1]!), token };
  }
  if (EDITOR_NEW_PATH.test(loc.pathname)) {
    return { kind: "editor", mapId: null };
  }
  const edit = EDITOR_EDIT_PATH.exec(loc.pathname);
  if (edit) {
    return { kind: "editor", mapId: decodeURIComponent(edit[1]!) };
  }
  if (MAPS_PATH.test(loc.pathname)) {
    return { kind: "maps" };
  }
  return { kind: "create", map: new URLSearchParams(loc.search).get("map") };
}

export function mapsUrl(): string {
  return "/maps";
}

export function editorUrl(mapId: string | null): string {
  return mapId === null ? "/maps/new" : `/maps/${encodeURIComponent(mapId)}/edit`;
}

export function createUrl(mapId?: string): string {
  return mapId ? `/?map=${encodeURIComponent(mapId)}` : "/";
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
  const [route, setRoute] = useState<Route>(() =>
    parseRoute({
      pathname: window.location.pathname,
      hash: window.location.hash,
      search: window.location.search
    })
  );
  useEffect(() => {
    const handler = () =>
      setRoute(
        parseRoute({
          pathname: window.location.pathname,
          hash: window.location.hash,
          search: window.location.search
        })
      );
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return route;
}
