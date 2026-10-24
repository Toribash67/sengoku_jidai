import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import type { HexTileSource, Pixel } from "@sengoku-jidai/engine/client";
import { axialKey, axialToPixel, pixelToAxial } from "@sengoku-jidai/engine/client";
import {
  axialsInRect,
  hexPoints,
  tileBoundarySegments,
  tileCentroid
} from "../../editor/geometry.js";
import { tileAt, type EditorAction, type EditorState } from "../../editor/reducer.js";
import {
  fitView,
  pinchView,
  toBoard,
  zoomView,
  type RectSize,
  type ViewportPoint,
  type ViewRect
} from "../../editor/viewport.js";

interface Gesture {
  mode: "paint" | "pan" | "pinch";
  startClientX: number;
  startClientY: number;
  viewX: number;
  viewY: number;
  moved: boolean;
  lastAxial: string | null;
}

interface EditorCanvasProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  view: ViewRect;
  onViewChange: Dispatch<SetStateAction<ViewRect>>;
}

export function EditorCanvas({ state, dispatch, view, onViewChange }: EditorCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, ViewportPoint>());
  const { doc, tool, selection, multiSelect } = state;
  const selected = new Set(selection);
  // The canvas's rendered size, so the viewBox can be fitted to its aspect (see `fitView`).
  const [size, setSize] = useState<RectSize>({ width: 0, height: 0 });
  // The board region actually on screen: what the viewBox renders and all pointer math uses.
  const shown = fitView(view, size);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  function relativePoint(event: ReactPointerEvent<SVGSVGElement>): ViewportPoint {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function toBoardPoint(client: { clientX: number; clientY: number }): Pixel {
    const rect = svgRef.current!.getBoundingClientRect();
    return toBoard(fitView(view, rect), rect, {
      x: client.clientX - rect.left,
      y: client.clientY - rect.top
    });
  }

  function paintAt(client: { clientX: number; clientY: number }): void {
    const hex = pixelToAxial(toBoardPoint(client), doc.layout);
    const key = axialKey(hex);
    if (gestureRef.current?.lastAxial === key) {
      return;
    }
    if (gestureRef.current) {
      gestureRef.current.lastAxial = key;
    }
    if (tool === "erase") {
      dispatch({ type: "eraseHex", hex });
    } else if (tool === "land" || tool === "sea") {
      dispatch({ type: "paintHex", kind: tool, hex });
    }
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    // Synthetic pointer events (dispatched by tests) have no active pointer to capture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const pointers = pointersRef.current;
    if (pointers.size >= 2) {
      return; // ignore fingers beyond the second
    }
    pointers.set(event.pointerId, relativePoint(event));
    if (pointers.size === 2) {
      // A second finger always means pan/pinch, abandoning any paint stroke
      // (already-painted hexes stay; undo covers mistakes).
      gestureRef.current = {
        mode: "pinch",
        startClientX: event.clientX,
        startClientY: event.clientY,
        viewX: view.x,
        viewY: view.y,
        moved: true,
        lastAxial: null
      };
      return;
    }
    const gesture: Gesture = {
      mode: tool !== "select" && event.button === 0 ? "paint" : "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
      lastAxial: null
    };
    gestureRef.current = gesture;
    if (gesture.mode === "paint") {
      paintAt(event);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    const pointers = pointersRef.current;
    if (!gesture || !pointers.has(event.pointerId)) {
      return;
    }
    if (gesture.mode === "pinch") {
      if (pointers.size === 2) {
        const rect = svgRef.current!.getBoundingClientRect();
        const prev = [...pointers.values()] as [ViewportPoint, ViewportPoint];
        pointers.set(event.pointerId, relativePoint(event));
        const curr = [...pointers.values()] as [ViewportPoint, ViewportPoint];
        onViewChange((v) => pinchView(fitView(v, rect), rect, prev, curr));
      }
      return;
    }
    pointers.set(event.pointerId, relativePoint(event));
    if (
      Math.abs(event.clientX - gesture.startClientX) +
        Math.abs(event.clientY - gesture.startClientY) >
      3
    ) {
      gesture.moved = true;
    }
    if (gesture.mode === "paint") {
      paintAt(event);
      return;
    }
    // Board units per client pixel come from the shown (aspect-fitted) region, so the board
    // tracks the cursor exactly; the view's own size is left as it was.
    const rect = svgRef.current!.getBoundingClientRect();
    const fitted = fitView(view, rect);
    const dx = ((event.clientX - gesture.startClientX) / rect.width) * fitted.width;
    const dy = ((event.clientY - gesture.startClientY) / rect.height) * fitted.height;
    onViewChange((v) => ({ ...v, x: gesture.viewX - dx, y: gesture.viewY - dy }));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const pointers = pointersRef.current;
    pointers.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (gesture?.mode === "pinch") {
      // Stay inert (no painting) with one finger left; the gesture ends when all lift.
      if (pointers.size === 0) {
        gestureRef.current = null;
      }
      return;
    }
    gestureRef.current = null;
    if (!gesture || gesture.mode !== "pan" || gesture.moved || tool !== "select") {
      return;
    }
    const hex = pixelToAxial(toBoardPoint(event), doc.layout);
    const tile = tileAt(doc, hex);
    dispatch({
      type: "selectTile",
      tileId: tile?.id ?? null,
      additive: event.shiftKey || multiSelect
    });
  }

  // Native non-passive wheel listener: React's synthetic onWheel can't preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const focus: ViewportPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      onViewChange((v) => zoomView(fitView(v, rect), rect, Math.exp(event.deltaY * 0.001), focus));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [onViewChange]);

  const gridCells = axialsInRect(shown, doc.layout);
  const boundaries = tileBoundarySegments(doc.tiles, doc.layout);

  return (
    <svg
      ref={svgRef}
      data-testid="editor-canvas"
      className={`editor-canvas is-tool-${tool}`}
      viewBox={`${shown.x} ${shown.y} ${shown.width} ${shown.height}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <g className="editor-grid">
        {gridCells.map((hex) => (
          <polygon
            key={axialKey(hex)}
            data-axial={`${hex.q},${hex.r}`}
            points={hexPoints(axialToPixel(hex, doc.layout), doc.layout.size)}
          />
        ))}
      </g>
      <g className="editor-tiles">
        {doc.tiles.map((tile) =>
          tile.hexes.map((hex) => (
            <polygon
              key={axialKey(hex)}
              data-tile-id={tile.id}
              data-axial={`${hex.q},${hex.r}`}
              className={`editor-hex is-${tile.kind}${selected.has(tile.id) ? " is-selected" : ""}`}
              points={hexPoints(axialToPixel(hex, doc.layout), doc.layout.size)}
            />
          ))
        )}
      </g>
      <g className="editor-boundaries">
        {boundaries.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </g>
      <g className="editor-badges">
        {doc.tiles.map((tile) => (
          <TileBadge key={tile.id} tile={tile} state={state} />
        ))}
      </g>
    </svg>
  );
}

function TileBadge({ tile, state }: { tile: HexTileSource; state: EditorState }) {
  const { doc } = state;
  const center = tileCentroid(tile.hexes, doc.layout);
  const deployment = doc.startingDeployment[tile.id];
  const lines: { text: string; seat?: string }[] = [];
  const traits: string[] = [];
  if (tile.features.hq) {
    traits.push(tile.features.hq === "red" ? "HQ·R" : "HQ·B");
  }
  if (tile.features.valueStars) {
    traits.push("★".repeat(tile.features.valueStars));
  }
  if (tile.features.harbor) {
    traits.push("⚓");
  }
  if (tile.features.fort) {
    traits.push("⛊");
  }
  if (tile.features.shellable) {
    traits.push("◎");
  }
  if (doc.bonusSlots.includes(tile.id)) {
    traits.push("✦");
  }
  if (traits.length > 0) {
    lines.push({ text: traits.join(" ") });
  }
  if (deployment) {
    // Foot troops ⚔ and catapults ⚙ (the doc's `troop` counts both; `siege` is the catapults).
    const foot = (deployment.troop ?? 0) - (deployment.siege ?? 0);
    const units = [
      foot > 0 ? `${foot}⚔` : null,
      deployment.siege ? `${deployment.siege}⚙` : null,
      deployment.ship ? `${deployment.ship}⛵` : null
    ]
      .filter(Boolean)
      .join(" ");
    lines.push({ text: units, seat: deployment.seat });
  }
  if (lines.length === 0) {
    return null;
  }
  return (
    <text x={center.x} y={center.y} className="editor-badge">
      {lines.map((line, i) => (
        <tspan key={i} x={center.x} dy={i === 0 ? 0 : "1.2em"} data-seat={line.seat}>
          {line.text}
        </tspan>
      ))}
    </text>
  );
}
