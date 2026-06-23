import type { LegalPlacement, LegalPlan } from "@sengoku-jidai/engine";

/** Support actions (Reinforce/Embark/Plan) have no board tile, so they are offered as a
 *  list in the side panel rather than via the map. Each entry opens the order composer. */
const PLACEMENT_LABEL: Record<LegalPlacement["type"], string> = {
  reinforce: "Reinforce",
  embark: "Embark"
};

interface SupportActionsProps {
  placements: LegalPlacement[];
  plans: LegalPlan[];
  busy: boolean;
  onStartPlacement: (placement: LegalPlacement) => void;
  onStartPlan: (plan: LegalPlan) => void;
}

export function SupportActions({
  placements,
  plans,
  busy,
  onStartPlacement,
  onStartPlan
}: SupportActionsProps) {
  if (placements.length === 0 && plans.length === 0) {
    return null;
  }

  return (
    <div className="support-actions">
      <h3 className="detail-subhead">Support actions</h3>
      <ul className="support-list">
        {placements.map((placement) => (
          <li key={placement.spaceId}>
            <button
              type="button"
              className="support-option"
              onClick={() => onStartPlacement(placement)}
              disabled={busy}
            >
              {PLACEMENT_LABEL[placement.type]}{" "}
              <span className="support-meta">
                up to {Math.min(placement.pool, placement.reserve)}
              </span>
            </button>
          </li>
        ))}
        {plans.map((plan) => (
          <li key={plan.spaceId}>
            <button
              type="button"
              className="support-option"
              onClick={() => onStartPlan(plan)}
              disabled={busy}
            >
              Plan {plan.initiative ? <span className="support-meta">★ initiative</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
