import { useEffect, useState, type FormEvent } from "react";
import type { SeatId } from "@sengoku-jidai/engine/client";
import { riversMapId } from "@sengoku-jidai/engine/client";
import type { MapSummary } from "@sengoku-jidai/shared";
import { listMaps } from "../client/api.js";
import { mapsUrl, navigateTo } from "../state/route.js";

interface CreateGameScreenProps {
  busy: boolean;
  error: string | null;
  preselectMapId: string | null;
  onCreate: (name: string, side: SeatId, mapId: string, opponent: "human" | "ai") => void;
}

const SIDES: { id: SeatId; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "black", label: "Black" }
];

export function CreateGameScreen({ busy, error, preselectMapId, onCreate }: CreateGameScreenProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<SeatId>("red");
  const [opponent, setOpponent] = useState<"human" | "ai">("human");
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [mapId, setMapId] = useState<string>(riversMapId);
  const trimmed = name.trim();
  // The opponent sits on the far side, so highlight the chosen opponent in the seat colour
  // opposite to the player's — a visual cue for who's across the board.
  const opponentSide: SeatId = side === "red" ? "black" : "red";

  useEffect(() => {
    let cancelled = false;
    setMaps(null);
    setMapsFailed(false);
    listMaps()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMaps(response.maps);
        if (preselectMapId && response.maps.some((m) => m.id === preselectMapId)) {
          setMapId(preselectMapId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapsFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [preselectMapId]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onCreate(trimmed, side, mapId, opponent);
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel create-screen" aria-label="Create game">
        <h1>General Orders: Sengoku Jidai</h1>
        <form className="create-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Nobunaga"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="map-select">Map</label>
              <button type="button" className="field-link" onClick={() => navigateTo(mapsUrl())}>
                Browse library →
              </button>
            </div>
            <select
              id="map-select"
              value={mapId}
              onChange={(event) => setMapId(event.target.value)}
            >
              {(
                maps ?? [
                  { id: riversMapId, name: "Rivers", tileCount: 22, builtin: true, updatedAt: null }
                ]
              ).map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name} ({map.tileCount} tiles)
                </option>
              ))}
            </select>
          </div>
          {mapsFailed ? (
            <p className="muted">Couldn’t load the map library — using Rivers.</p>
          ) : null}

          <fieldset className="side-toggle">
            <legend>Your side</legend>
            {SIDES.map((option) => (
              <button
                key={option.id}
                type="button"
                data-side={option.id}
                aria-pressed={side === option.id}
                className={side === option.id ? "is-active" : ""}
                onClick={() => setSide(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>

          <fieldset className="side-toggle">
            <legend>Opponent</legend>
            <button
              type="button"
              data-side={opponentSide}
              aria-pressed={opponent === "human"}
              className={opponent === "human" ? "is-active" : ""}
              onClick={() => setOpponent("human")}
            >
              Human (invite a friend)
            </button>
            <button
              type="button"
              data-side={opponentSide}
              aria-pressed={opponent === "ai"}
              className={opponent === "ai" ? "is-active" : ""}
              onClick={() => setOpponent("ai")}
            >
              Computer (AI)
            </button>
          </fieldset>

          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Creating…" : "Create game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
