import type {
  PlayerAreaView,
  PlayerGameEvent,
  PlayerGameView,
  SeatId
} from "@sengoku-jidai/engine";
import { useEffect, useMemo, useState } from "react";
import { Board } from "./components/board/Board.js";
import { ApiError, createHotseatGame, fetchGameView, submitCommand } from "./client/api.js";
import {
  clearStoredGame,
  loadStoredGame,
  saveStoredGame,
  type StoredGame
} from "./state/localGame.js";

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

  async function handleClaimArea(area: PlayerAreaView) {
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
      const response = await submitCommand(game.gameId, token, game.revision, {
        type: "claimArea",
        areaId: area.id
      });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
      setSelectedAreaId(area.id);
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

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>General Orders: Sengoku Jidai</h1>
          <p>{game.view.prompt}</p>
        </div>
        <div className="top-stats" aria-label="Game status">
          <span>Round {game.view.round}</span>
          <span>Revision {game.revision}</span>
          <span>{game.view.activeSeat} to act</span>
        </div>
      </header>

      <section className="game-layout">
        <Board
          areas={game.view.areas}
          activeSeat={game.view.activeSeat}
          selectedAreaId={selectedAreaId}
          onSelectArea={setSelectedAreaId}
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
            <h2>{selectedArea ? selectedArea.name : "Select an area"}</h2>
            {selectedArea ? (
              <>
                <dl className="area-details">
                  <div>
                    <dt>Control</dt>
                    <dd>{selectedArea.controller ?? "none"}</dd>
                  </div>
                  <div>
                    <dt>Strength</dt>
                    <dd>{selectedArea.strength}</dd>
                  </div>
                  <div>
                    <dt>Adjacent</dt>
                    <dd>{selectedArea.adjacent.join(", ")}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => handleClaimArea(selectedArea)}
                  disabled={busy || game.view.activeSeat !== game.activeSeat}
                >
                  Claim area
                </button>
              </>
            ) : (
              <p className="muted">Area details and legal commands appear here.</p>
            )}
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
  if (event.type === "areaClaimed") {
    return `${event.seat} claimed ${event.areaId}`;
  }
  return `${event.seat} chose ${event.choiceId}`;
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
