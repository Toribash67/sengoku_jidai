import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent
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
import { INITIAL_VIEW, toBoard, zoomView, type ViewportPoint } from "../../editor/viewport.js";

interface Gesture {
  mode: "paint" | "pan";
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
}

export function EditorCanvas({ state, dispatch }: EditorCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState(INITIAL_VIEW);
  const gestureRef = useRef<Gesture | null>(null);
  const { doc, tool, selection, multiSelect } = state;
  const selected = new Set(selection);

  function toBoardPoint(client: { clientX: number; clientY: number }): Pixel {
    const rect = svgRef.current!.getBoundingClientRect();
    return toBoard(view, rect, { x: client.clientX - rect.left, y: client.clientY - rect.top });
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
    event.currentTarget.setPointerCapture(event.pointerId);
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
    if (!gesture) {
      return;
    }
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
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = ((event.clientX - gesture.startClientX) / rect.width) * view.width;
    const dy = ((event.clientY - gesture.startClientY) / rect.height) * view.height;
    setView((v) => ({ ...v, x: gesture.viewX - dx, y: gesture.viewY - dy }));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
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
      setView((v) => zoomView(v, rect, Math.exp(event.deltaY * 0.001), focus));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  const gridCells = axialsInRect(view, doc.layout);
  const boundaries = tileBoundarySegments(doc.tiles, doc.layout);
  const primary = doc.tiles.find((t) => t.id === selection[0]);

  return (
    <svg
      ref={svgRef}
      data-testid="editor-canvas"
      className={`editor-canvas is-tool-${tool}`}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
      {primary?.features.harbor && primary.ports ? (
        <g className="editor-ports">
          {primary.ports.map((seaId) => {
            const sea = doc.tiles.find((t) => t.id === seaId);
            if (!sea) {
              return null;
            }
            const from = tileCentroid(primary.hexes, doc.layout);
            const to = tileCentroid(sea.hexes, doc.layout);
            return <line key={seaId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })}
        </g>
      ) : null}
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
    const units = [
      deployment.troop ? `${deployment.troop}⚔` : null,
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
