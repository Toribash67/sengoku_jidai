import { useEffect, useRef, useState } from "react";
import type { TerrainStatus } from "@sengoku-jidai/shared";
import { ApiError, fetchMap, generateTerrain } from "../../client/api.js";

export type TerrainUi = "idle" | "pending" | "ready" | "failed" | "unavailable";

/** Pure: UI state reflecting a known terrain status — used to seed the button on load and
 *  after each poll. "none" (nothing generated yet) maps to the idle "Generate terrain" state. */
export function uiFromStatus(terrain: TerrainStatus): TerrainUi {
  switch (terrain) {
    case "ready":
      return "ready";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    case "none":
      return "idle";
  }
}

/** Pure: UI state for a failed generate POST, by HTTP status — 503 unavailable (no FAL_KEY),
 *  409 a generation is already running (resume polling), anything else a generic failure. */
export function uiFromError(status: number | null): TerrainUi {
  return status === 503 ? "unavailable" : status === 409 ? "pending" : "failed";
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
  // Token for the current lifecycle (one per mount, replaced on each mapId change). Every async
  // continuation — the seed fetch and the poll chain — captures the token it started under and
  // bails once it is cancelled, so nothing calls setState after unmount or a map change.
  const runRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  async function poll(run: { cancelled: boolean }): Promise<void> {
    if (run.cancelled) {
      return;
    }
    let terrain: TerrainStatus;
    try {
      terrain = (await fetchMap(mapId)).terrain;
    } catch {
      return; // transient fetch error: stop polling; leave the button in its current state
    }
    if (run.cancelled) {
      return;
    }
    const next = uiFromStatus(terrain);
    setState(next);
    if (next === "pending") {
      window.setTimeout(() => void poll(run), 1500);
    }
  }

  // Seed the button from the map's persisted terrain status on mount / map change, and resume
  // polling if a generation is already in flight (e.g. started in a prior session).
  useEffect(() => {
    const run = { cancelled: false };
    runRef.current = run;
    void (async () => {
      let terrain: TerrainStatus;
      try {
        terrain = (await fetchMap(mapId)).terrain;
      } catch {
        return; // leave the button idle if the status can't be read
      }
      if (run.cancelled) {
        return;
      }
      const seeded = uiFromStatus(terrain);
      setState(seeded);
      if (seeded === "pending") {
        window.setTimeout(() => void poll(run), 1500);
      }
    })();
    return () => {
      run.cancelled = true; // invalidate this lifecycle's in-flight continuations
    };
    // poll closes over mapId and is recreated each render; the effect only needs to re-run on mapId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId]);

  async function handleClick(): Promise<void> {
    setState("pending");
    const run = runRef.current;
    try {
      await generateTerrain(mapId);
      void poll(run);
    } catch (err) {
      if (run.cancelled) {
        return; // the map changed / unmounted while the POST was in flight
      }
      const next = uiFromError(err instanceof ApiError ? err.status : null);
      setState(next);
      if (next === "pending") {
        void poll(run); // 409: a generation is already running — track it to completion
      }
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
