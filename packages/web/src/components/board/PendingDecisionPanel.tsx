import type { PendingChoice, PendingDecision } from "@sengoku-jidai/engine";

interface PendingDecisionPanelProps {
  decision: PendingDecision;
  busy: boolean;
  onChoose: (choice: PendingChoice) => void;
  /** Override the button text for a choice (e.g. map a battle's area id to its name). */
  renderLabel?: (choice: PendingChoice) => string;
}

/** Renders a pending decision (the Ship Strike "Shell again / Decline" follow-up, or the
 *  "choose which sea battle" picker) as a prompt with one button per choice. Shown in place of
 *  the order bar while the engine waits on the responsible seat. */
export function PendingDecisionPanel({
  decision,
  busy,
  onChoose,
  renderLabel
}: PendingDecisionPanelProps) {
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
            {renderLabel ? renderLabel(choice) : choice.label}
          </button>
        ))}
      </span>
    </div>
  );
}
