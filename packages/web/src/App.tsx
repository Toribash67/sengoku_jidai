import type { PlayerGameEvent, PlayerGameView, SeatId } from "@sengoku-jidai/engine";
import { getMap } from "@sengoku-jidai/engine";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { AreaDetails } from "./components/board/AreaDetails.js";
import { MapBoard } from "./components/board/MapBoard.js";
import { ApiError, createHotseatGame, fetchGameView, submitCommand } from "./client/api.js";
import {
  clearStoredGame,
  loadPanelWidth,
  loadStoredGame,
  savePanelWidth,
  saveStoredGame,
  type StoredGame
} from "./state/localGame.js";

const MIN_PANEL_WIDTH = 260;
const MIN_MAP_WIDTH = 360;
const DEFAULT_PANEL_WIDTH = 340;

interface LoadedGame extends StoredGame {
  revision: number;
  view: PlayerGameView;
}

export function App() {
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [events, setEvents] = useState<PlayerGameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => loadPanelWidth() ?? DEFAULT_PANEL_WIDTH);
  const layoutRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    savePanelWidth(panelWidth);
  }, [panelWidth]);

  function handleDividerPointerDown(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDividerPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !layoutRef.current) {
      return;
    }
    const rect = layoutRef.current.getBoundingClientRect();
    const max = Math.max(MIN_PANEL_WIDTH, rect.width - MIN_MAP_WIDTH);
    const next = Math.min(Math.max(rect.right - event.clientX, MIN_PANEL_WIDTH), max);
    setPanelWidth(next);
  }

  function handleDividerPointerUp(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    const stored = loadStoredGame();
    if (!stored) {
      return;
    }

    const token = stored.seats.find((seat) => seat.seat === stored.activeSeat)?.token;
    if (!token) {
      clearStoredGame();
      return;
    }

    void fetchGameView(stored.gameId, token)
      .then((envelope) => {
        setGame({ ...stored, revision: envelope.revision, view: envelope.view });
      })
      .catch(() => {
        clearStoredGame();
      });
  }, []);

  const selectedArea = useMemo(
    () => game?.view.areas.find((area) => area.id === selectedAreaId) ?? null,
    [game?.view.areas, selectedAreaId]
  );

  const selectedMapArea = useMemo(
    () => (game && selectedAreaId ? (getMap(game.view.mapId).areas[selectedAreaId] ?? null) : null),
    [game, selectedAreaId]
  );

  async function handleCreateGame() {
    setBusy(true);
    setError(null);
    try {
      const created = await createHotseatGame();
      const stored: StoredGame = {
        gameId: created.gameId,
        activeSeat: created.seat,
        seats: created.seats
      };
      saveStoredGame(stored);
      setGame({ ...stored, revision: created.revision, view: created.view });
      setSelectedAreaId(null);
      setEvents([]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchSeat(seat: SeatId) {
    if (!game) {
      return;
    }
    const token = game.seats.find((seatToken) => seatToken.seat === seat)?.token;
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await fetchGameView(game.gameId, token);
      const stored = { gameId: game.gameId, activeSeat: seat, seats: game.seats };
      saveStoredGame(stored);
      setGame({ ...stored, revision: envelope.revision, view: envelope.view });
      setSelectedAreaId(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handlePass() {
    if (!game) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, { type: "pass" });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!game) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Start game">
          <h1>General Orders: Sengoku Jidai</h1>
          <button type="button" onClick={handleCreateGame} disabled={busy}>
            {busy ? "Creating..." : "New hotseat game"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </section>
      </main>
    );
  }

  const isViewerActive = game.view.activeSeat === game.activeSeat;

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>General Orders: Sengoku Jidai</h1>
          <p>{game.view.prompt}</p>
        </div>
        <div className="top-stats" aria-label="Game status">
          <span>Round {game.view.round}</span>
          <span>{game.view.phase}</span>
          <span>Revision {game.revision}</span>
          <span>{game.view.activeSeat} to act</span>
          <span>
            VP {game.view.victoryPoints.red}–{game.view.victoryPoints.black}
          </span>
        </div>
      </header>

      <section
        className="game-layout"
        ref={layoutRef}
        style={{ "--panel-width": `${panelWidth}px` } as CSSProperties}
      >
        <MapBoard
          areas={game.view.areas}
          activeSeat={game.view.activeSeat}
          selectedAreaId={selectedAreaId}
          actionSpaces={game.view.actionSpaces}
          onSelectArea={setSelectedAreaId}
        />

        <div
          className="layout-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize map and panel"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
        />

        <aside className="side-panel" aria-label="Command panel">
          <div className="seat-switcher" role="group" aria-label="Seat">
            {game.seats.map((seat) => (
              <button
                key={seat.seat}
                type="button"
                className={seat.seat === game.activeSeat ? "is-active" : ""}
                onClick={() => handleSwitchSeat(seat.seat)}
                disabled={busy}
              >
                {seat.seat}
              </button>
            ))}
          </div>

          <section className="panel-section">
            <h2>{selectedArea ? selectedArea.id : "Select an area"}</h2>
            {selectedArea && selectedMapArea ? (
              <AreaDetails area={selectedArea} mapArea={selectedMapArea} view={game.view} />
            ) : (
              <p className="muted">Select an area to see its details.</p>
            )}
            <button
              type="button"
              onClick={handlePass}
              disabled={busy || !isViewerActive || !game.view.legal.canPass}
            >
              Pass
            </button>
          </section>

          <section className="panel-section">
            <h2>Recent events</h2>
            {events.length === 0 ? (
              <p className="muted">No commands submitted yet.</p>
            ) : (
              <ol className="event-log">
                {events.map((event, index) => (
                  <li key={`${event.type}-${index}`}>{eventLabel(event)}</li>
                ))}
              </ol>
            )}
          </section>

          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              clearStoredGame();
              setGame(null);
            }}
          >
            Clear local game
          </button>

          {error ? <p className="error-text">{error}</p> : null}
        </aside>
      </section>
    </main>
  );
}

function eventLabel(event: PlayerGameEvent): string {
  if ("seat" in event && typeof event.seat === "string") {
    return `${event.seat}: ${event.type}`;
  }
  return event.type;
}

function errorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { error?: { message?: string } };
    return body.error?.message ?? caught.message;
  }
  if (caught instanceof Error) {
    return caught.message;
  }
  return "Unexpected error.";
}
