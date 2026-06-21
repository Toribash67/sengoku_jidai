import type { LegalMove, MapArea, PlayerAreaView, PlayerGameView } from "@sengoku-jidai/engine";

/** Display names for the on-map action types that link to a board area. */
const ACTION_LABEL: Record<string, string> = {
  advance: "Advance",
  sail: "Sail",
  bombard: "Bombard",
  shell: "Shell"
};

interface AreaDetailsProps {
  area: PlayerAreaView;
  mapArea: MapArea;
  view: PlayerGameView;
  onStartOrder?: (move: LegalMove) => void;
}

export function AreaDetails({ area, mapArea, view, onStartOrder }: AreaDetailsProps) {
  const bonus = view.bonuses[area.id] ?? null;
  const move = view.legal.moves.find((candidate) => candidate.targetAreaId === area.id) ?? null;

  const actions = view.legal.spaces
    .filter((space) => space.areaId === area.id)
    .map((space) => ({
      id: space.spaceId,
      label: ACTION_LABEL[space.type] ?? space.type,
      occupant: view.actionSpaces[space.spaceId] ?? null,
      deployable: space.legal
    }));

  return (
    <>
      <dl className="area-details">
        <div>
          <dt>Owner</dt>
          <dd>{area.owner ?? "none"}</dd>
        </div>
        <div>
          <dt>Units</dt>
          <dd>
            {area.units.troop} troops, {area.units.ship} ships
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{area.valueStars} stars</dd>
        </div>
        <div>
          <dt>Supplied by</dt>
          <dd>{area.suppliedBy ?? "none"}</dd>
        </div>
      </dl>

      <h3 className="detail-subhead">Traits</h3>
      <ul className="trait-list">
        <li>Terrain: {mapArea.kind}</li>
        {mapArea.hq ? <li>{mapArea.hq} HQ</li> : null}
        {mapArea.harbor ? <li>Harbor</li> : null}
        {mapArea.ports.length > 0 ? <li>Piers &rarr; {mapArea.ports.join(", ")}</li> : null}
        {bonus ? <li>Bonus: {bonus}</li> : null}
      </ul>

      <h3 className="detail-subhead">Actions</h3>
      {actions.length === 0 ? (
        <p className="muted">No actions on this area.</p>
      ) : (
        <ul className="action-list">
          {actions.map((action) => (
            <li key={action.id}>
              <span className="action-name">{action.label}</span>
              <span
                className={
                  action.occupant ? `action-used action-${action.occupant}` : "action-open"
                }
              >
                {action.occupant
                  ? `used by ${action.occupant}`
                  : action.deployable
                    ? "open (deployable now)"
                    : "open"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {move && onStartOrder ? (
        <button type="button" className="start-order" onClick={() => onStartOrder(move)}>
          {move.type === "advance" ? "Advance" : "Sail"} into {move.targetAreaId}
        </button>
      ) : null}
    </>
  );
}
