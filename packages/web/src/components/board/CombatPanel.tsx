import type { PendingCombat } from "@sengoku-jidai/engine";

interface CombatPanelProps {
  pendingCombat: PendingCombat;
  /** Human label for the contested area (never a raw tile id). */
  areaLabel: string;
  /** True when the viewer may roll (dice not yet thrown). */
  canRoll: boolean;
  /** True when the dice are shown and the viewer may continue (apply casualties). */
  canResolve: boolean;
  /** True when the viewer holds a card they could discard to reroll. */
  canReroll: boolean;
  busy: boolean;
  onRoll: () => void;
  onResolve: () => void;
}

/** Headline + sub-text describing a pending combat, with no tile ids. Pure + exported for
 *  testing. */
export function describeCombat(
  pendingCombat: PendingCombat,
  areaLabel: string
): { headline: string; detail: string; diceCount: number } {
  const { kind, attacker, defender, attackers, defenders, dice } = pendingCombat;
  if (kind === "advance" || kind === "sail") {
    return {
      headline: `Battle for ${areaLabel}`,
      detail: `${attacker} sends ${attackers} vs ${defender}'s ${defenders} — ${defender} rolls the defence die`,
      diceCount: 1
    };
  }
  const verb = kind === "bombard" ? "Bombard" : "Shell";
  return {
    headline: `${verb} on ${areaLabel}`,
    detail: `${attacker} rolls ${dice} ${dice === 1 ? "die" : "dice"}`,
    diceCount: dice ?? 0
  };
}

/** A row of dice: the rolled faces once thrown, else placeholders for the count to come. */
function DiceRow({ count, values }: { count: number; values?: number[] }) {
  const faces: (number | null)[] = values ?? Array.from({ length: count }, () => null);
  return (
    <span className="combat-dice" aria-hidden="true">
      {faces.map((face, i) => (
        <span key={i} className={face === null ? "die die-pending" : "die die-rolled"}>
          {face === null ? "?" : face}
        </span>
      ))}
    </span>
  );
}

/** The interactive combat step. Phase `awaiting-roll`: show the matchup and let the
 *  responsible seat roll. Phase `rolled`: show the dice and let them continue (apply
 *  casualties) — the disabled "Reroll" control is the seam for future card-driven rerolls. */
export function CombatPanel({
  pendingCombat,
  areaLabel,
  canRoll,
  canResolve,
  canReroll,
  busy,
  onRoll,
  onResolve
}: CombatPanelProps) {
  const { headline, detail, diceCount } = describeCombat(pendingCombat, areaLabel);
  const rolled = pendingCombat.phase === "rolled";
  const responsible = canRoll || canResolve;
  return (
    <div className="combat-panel" aria-label="Combat">
      <div className="combat-info">
        <strong>{headline}</strong>
        <span className="combat-detail">{detail}</span>
      </div>
      <DiceRow count={diceCount} values={rolled ? pendingCombat.rolls : undefined} />
      {rolled ? <span className="combat-total">= {pendingCombat.total}</span> : null}
      <span className="combat-buttons">
        {!responsible ? (
          <span className="action-bar-hint">
            Waiting for {pendingCombat.responsibleSeat} to {rolled ? "continue" : "roll"}…
          </span>
        ) : rolled ? (
          <>
            <button type="button" onClick={onResolve} disabled={busy || !canResolve}>
              Continue
            </button>
            <span className="action-bar-hint">
              {canReroll
                ? "…or open a card below and discard it to reroll."
                : "No cards to reroll."}
            </span>
          </>
        ) : (
          <button type="button" onClick={onRoll} disabled={busy || !canRoll}>
            Roll
          </button>
        )}
      </span>
    </div>
  );
}
