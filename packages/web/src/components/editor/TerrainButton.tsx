import { useState } from "react";
import type { TerrainStatus } from "@sengoku-jidai/shared";
import { ApiError, fetchMap, generateTerrain } from "../../client/api.js";

export type TerrainUi = "idle" | "pending" | "ready" | "failed" | "unavailable";

type TerrainEvent =
  | { kind: "start" }
  | { kind: "poll"; terrain: TerrainStatus }
  | { kind: "error"; unavailable: boolean };

/** Pure: next UI state for a generation outcome. */
export function nextTerrainUiState(event: TerrainEvent): TerrainUi {
  switch (event.kind) {
    case "start":
      return "pending";
    case "poll":
      return event.terrain === "ready"
        ? "ready"
        : event.terrain === "failed"
          ? "failed"
          : "pending";
    case "error":
      return event.unavailable ? "unavailable" : "failed";
  }
}

const LABEL: Record<TerrainUi, string> = {
  idle: "Generate terrain",
  pending: "Generating terrain…",
  ready: "Terrain ready — regenerate",
  failed: "Regenerate terrain",
  unavailable: "Generate terrain"
};

export function TerrainButton({ mapId }: { mapId: string }) {
  const [state, setState] = useState<TerrainUi>("idle");

  async function poll(): Promise<void> {
    const detail = await fetchMap(mapId);
    const next = nextTerrainUiState({ kind: "poll", terrain: detail.terrain });
    setState(next);
    if (next === "pending") {
      window.setTimeout(() => void poll(), 1500);
    }
  }

  async function handleClick(): Promise<void> {
    setState(nextTerrainUiState({ kind: "start" }));
    try {
      await generateTerrain(mapId);
      void poll();
    } catch (err) {
      const unavailable = err instanceof ApiError && err.status === 503;
      setState(nextTerrainUiState({ kind: "error", unavailable }));
    }
  }

  return (
    <div className="editor-terrain">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={state === "pending" || state === "unavailable"}
      >
        {LABEL[state]}
      </button>
      {state === "failed" ? <span className="muted">Generation failed — try again.</span> : null}
      {state === "unavailable" ? (
        <span className="muted">Terrain generation isn’t configured on the server.</span>
      ) : null}
    </div>
  );
}
