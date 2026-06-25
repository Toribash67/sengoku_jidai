import type { PendingChoice, PendingDecision } from "@sengoku-jidai/engine";

interface PendingDecisionPanelProps {
  decision: PendingDecision;
  busy: boolean;
  onChoose: (choice: PendingChoice) => void;
}

/** Renders a pending decision (currently the Ship Strike "Shell again / Decline" follow-up)
 *  as a prompt with one button per choice. Shown in place of the order bar while the engine
 *  waits on the responsible seat. */
export function PendingDecisionPanel({ decision, busy, onChoose }: PendingDecisionPanelProps) {
  return (
    <div className="combat-panel" aria-label="Decision">
      <div className="combat-info">
        <strong>{decision.prompt}</strong>
      </div>
      <span className="combat-buttons">
        {decision.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={choice.id === "decline" ? "secondary-action" : undefined}
            onClick={() => onChoose(choice)}
            disabled={busy}
          >
            {choice.label}
          </button>
        ))}
      </span>
    </div>
  );
}
