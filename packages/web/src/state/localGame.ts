import type { SeatToken } from "@sengoku-jidai/shared";

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
