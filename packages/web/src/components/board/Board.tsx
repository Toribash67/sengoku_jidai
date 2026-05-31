import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";

interface BoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  onSelectArea: (areaId: string) => void;
}

const geometry: Record<string, { x: number; y: number; w: number; h: number }> = {
  yamashiro: { x: 210, y: 155, w: 170, h: 120 },
  omi: { x: 395, y: 120, w: 175, h: 130 },
  mino: { x: 590, y: 125, w: 160, h: 120 },
  yamato: { x: 250, y: 310, w: 190, h: 120 },
  ise: { x: 470, y: 290, w: 185, h: 135 }
};

export function Board({ areas, activeSeat, selectedAreaId, onSelectArea }: BoardProps) {
  return (
    <svg
      className="board"
      viewBox="0 0 960 560"
      role="img"
      aria-label="Sengoku Jidai battlefield"
      data-testid="board"
    >
      <rect className="board-background" x="0" y="0" width="960" height="560" rx="0" />
      <g className="board-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <line key={`v-${index}`} x1={120 + index * 90} y1="70" x2={120 + index * 90} y2="500" />
        ))}
        {Array.from({ length: 5 }, (_, index) => (
          <line key={`h-${index}`} x1="120" y1={100 + index * 85} x2="840" y2={100 + index * 85} />
        ))}
      </g>
      <g>
        {areas.map((area) => {
          const box = geometry[area.id] ?? { x: 80, y: 80, w: 160, h: 120 };
          const selected = selectedAreaId === area.id;
          const ownerClass = area.controller ? `area-${area.controller}` : "area-neutral";
          return (
            <g key={area.id}>
              <rect
                className={`area ${ownerClass} ${selected ? "area-selected" : ""}`}
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx="8"
                role="button"
                aria-label={`Select ${area.name}`}
                data-testid={`area-${area.id}`}
                tabIndex={0}
                onClick={() => onSelectArea(area.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectArea(area.id);
                  }
                }}
              />
              <text className="area-label" x={box.x + 18} y={box.y + 36}>
                {area.name}
              </text>
              <text className="area-meta" x={box.x + 18} y={box.y + 66}>
                {area.controller ? `${area.controller} control` : "uncontrolled"}
              </text>
              {area.commander ? (
                <g className={`commander commander-${area.commander}`}>
                  <circle cx={box.x + box.w - 34} cy={box.y + 34} r="16" />
                  <text x={box.x + box.w - 34} y={box.y + 40}>
                    {area.commander === "red" ? "R" : "B"}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </g>
      <text className="board-status" x="120" y="520">
        Active seat: {activeSeat}
      </text>
    </svg>
  );
}
