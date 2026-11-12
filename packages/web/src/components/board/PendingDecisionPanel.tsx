import type { PendingChoice, PendingDecision } from "@sengoku-jidai/engine/client";

interface PendingDecisionPanelProps {
  decision: PendingDecision;
  busy: boolean;
  onChoose: (choice: PendingChoice) => void;
  /** Choices that name a map tile. They glow on the map and are picked there, then confirmed
   *  here; every other choice (e.g. "decline") keeps its own button. */
  tileChoices: PendingChoice[];
  /** The tile choice currently picked on the map, or null when none is yet. */
  pickedChoice: PendingChoice | null;
  /** Text of the button that submits the picked tile. */
  confirmLabel: string;
  /** An action answered outside the choice list (Siege Assault opens an Advance composer). */
  primaryAction?: { label: string; onClick: () => void };
}

/** Renders a pending decision (the Ship Strike "Shell again / Decline" follow-up, the Siege
 *  Assault offer, or the "choose which sea battle" picker) as a prompt. Tile choices are picked on the map and
 *  confirmed with one button; other choices get a button each. Shown in place of the order bar
 *  while the engine waits on the responsible seat. */
export function PendingDecisionPanel({
  decision,
  busy,
  onChoose,
  tileChoices,
  pickedChoice,
  confirmLabel,
  primaryAction
}: PendingDecisionPanelProps) {
  const hasTiles = tileChoices.length > 0;
  const buttonChoices = decision.choices.filter((choice) => !tileChoices.includes(choice));
  return (
    <div className="combat-panel" aria-label="Decision">
      <div className="combat-info">
        <strong>{decision.prompt}</strong>
        {hasTiles ? (
          <span className="action-bar-hint">
            {tileChoices.length > 1 ? "Tap a glowing area to target it. " : null}
            <span className="action-bar-total">
              {pickedChoice ? "Target selected" : "No target yet"}
            </span>
          </span>
        ) : null}
      </div>
      <span className="combat-buttons">
        {primaryAction ? (
          <button type="button" onClick={primaryAction.onClick} disabled={busy}>
            {primaryAction.label}
          </button>
        ) : null}
        {hasTiles ? (
          <button
            type="button"
            onClick={() => pickedChoice && onChoose(pickedChoice)}
            disabled={busy || !pickedChoice}
          >
            {confirmLabel}
          </button>
        ) : null}
        {buttonChoices.map((choice) => (
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
