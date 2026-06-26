import type { SeatId, SeatToken } from "@sengoku-jidai/shared";

// --- Legacy single-game storage (still used by App until the routing rewire lands) ---
const storageKey = "sengoku-jidai.hotseat";

export interface StoredGame {
  gameId: string;
  activeSeat: string;
  seats: SeatToken[];
}

export function loadStoredGame(): StoredGame | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredGame;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function saveStoredGame(game: StoredGame): void {
  localStorage.setItem(storageKey, JSON.stringify(game));
}

export function clearStoredGame(): void {
  localStorage.removeItem(storageKey);
}

// --- Per-game seat-token cache (the link is the source of truth; this is convenience) ---
const seatsKey = "sengoku-jidai.games";

const seatOrder: Record<SeatId, number> = { red: 0, black: 1 };

type SeatStore = Record<string, SeatToken[]>;

function readSeatStore(): SeatStore {
  const raw = localStorage.getItem(seatsKey);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as SeatStore;
  } catch {
    localStorage.removeItem(seatsKey);
    return {};
  }
}

function writeSeatStore(store: SeatStore): void {
  localStorage.setItem(seatsKey, JSON.stringify(store));
}

/** Merge incoming seat tokens over existing ones (incoming wins per seat), red before black. */
export function mergeSeatTokens(existing: SeatToken[], incoming: SeatToken[]): SeatToken[] {
  const bySeat = new Map<SeatId, SeatToken>();
  for (const token of existing) {
    bySeat.set(token.seat, token);
  }
  for (const token of incoming) {
    bySeat.set(token.seat, token);
  }
  return [...bySeat.values()].sort((a, b) => seatOrder[a.seat] - seatOrder[b.seat]);
}

export function loadSeatTokens(gameId: string): SeatToken[] {
  return readSeatStore()[gameId] ?? [];
}

export function rememberSeatTokens(gameId: string, seats: SeatToken[]): void {
  const store = readSeatStore();
  store[gameId] = mergeSeatTokens(store[gameId] ?? [], seats);
  writeSeatStore(store);
}

export function forgetGame(gameId: string): void {
  const store = readSeatStore();
  delete store[gameId];
  writeSeatStore(store);
}

const panelWidthKey = "sengoku-jidai.panelWidth";

/** Persisted side-panel width in px, or null if unset/invalid. */
export function loadPanelWidth(): number | null {
  const raw = localStorage.getItem(panelWidthKey);
  if (raw === null) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function savePanelWidth(width: number): void {
  localStorage.setItem(panelWidthKey, String(Math.round(width)));
}
