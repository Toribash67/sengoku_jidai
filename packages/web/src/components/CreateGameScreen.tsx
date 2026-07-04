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
  onCreate: (name: string, side: SeatId, mapId: string) => void;
}

const SIDES: { id: SeatId; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "black", label: "Black" }
];

export function CreateGameScreen({ busy, error, preselectMapId, onCreate }: CreateGameScreenProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<SeatId>("red");
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [mapId, setMapId] = useState<string>(riversMapId);
  const trimmed = name.trim();

  useEffect(() => {
    let cancelled = false;
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
    onCreate(trimmed, side, mapId);
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

          <label className="field">
            <span>Map</span>
            <select value={mapId} onChange={(event) => setMapId(event.target.value)}>
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
          </label>
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

          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Creating…" : "Create game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="button" className="secondary-action" onClick={() => navigateTo(mapsUrl())}>
          Map library
        </button>
      </section>
    </main>
  );
}
