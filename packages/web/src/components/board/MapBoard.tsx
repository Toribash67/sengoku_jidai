import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../cloned_map.svg?raw";

export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
}

export function MapBoard({ activeSeat }: MapBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Inject the raw SVG once on mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = rawMapSvg;
  }, []);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
