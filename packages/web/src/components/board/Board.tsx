import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";

interface BoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  onSelectArea: (areaId: string) => void;
}

export function Board({ areas, activeSeat, selectedAreaId, onSelectArea }: BoardProps) {
  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <ul className="area-grid">
        {areas.map((area) => {
          const selected = selectedAreaId === area.id;
          const ownerClass = area.owner ? `area-${area.owner}` : "area-neutral";
          return (
            <li key={area.id}>
              <button
                type="button"
                className={`area-card ${ownerClass} ${selected ? "area-selected" : ""}`}
                data-testid={`area-${area.id}`}
                aria-pressed={selected}
                onClick={() => onSelectArea(area.id)}
              >
                <span className="area-card-id">{area.id}</span>
                <span className="area-card-kind">{area.kind}</span>
                <span className="area-card-owner">{area.owner ?? "unclaimed"}</span>
                <span className="area-card-units">
                  {area.units.troop}t / {area.units.ship}s
                </span>
                {area.valueStars > 0 ? (
                  <span className="area-card-stars">{"★".repeat(area.valueStars)}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
