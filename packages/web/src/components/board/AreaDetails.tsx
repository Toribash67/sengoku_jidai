import type { MapArea, PlayerAreaView, PlayerGameView } from "@sengoku-jidai/engine";

interface AreaDetailsProps {
  area: PlayerAreaView;
  mapArea: MapArea;
  view: PlayerGameView;
}

/** Read-only information about the selected area. Orders are issued from the bottom action
 *  bar, not here, so this panel carries no buttons and never shows raw tile ids. */
export function AreaDetails({ area, mapArea, view }: AreaDetailsProps) {
  const bonus = view.bonuses[area.id] ?? null;

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
        {mapArea.harbor ? <li>Harbour</li> : null}
        {mapArea.ports.length > 0 ? <li>Has piers</li> : null}
        {mapArea.shellable ? <li>Coastal (can be shelled)</li> : null}
        {bonus ? <li>Bonus: {bonus}</li> : null}
      </ul>
    </>
  );
}
