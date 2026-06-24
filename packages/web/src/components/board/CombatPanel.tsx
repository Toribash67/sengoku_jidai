import type { PendingCombat } from "@sengoku-jidai/engine";

interface CombatPanelProps {
  pendingCombat: PendingCombat;
  /** Human label for the contested area (never a raw tile id). */
  areaLabel: string;
  /** True when the viewer is the seat that must roll. */
  canRoll: boolean;
  busy: boolean;
  onRoll: () => void;
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

/** A row of placeholder dice glyphs for the dice about to be rolled. */
function DiceRow({ count }: { count: number }) {
  return (
    <span className="combat-dice" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="die die-pending">
          ?
        </span>
      ))}
    </span>
  );
}

/** The interactive combat step: shows the matchup and lets the responsible seat roll. The
 *  disabled "Play card" control is the seam for future card-driven reroll/extra dice. The
 *  rolled values and casualties appear in the event log once resolved. */
export function CombatPanel({ pendingCombat, areaLabel, canRoll, busy, onRoll }: CombatPanelProps) {
  const { headline, detail, diceCount } = describeCombat(pendingCombat, areaLabel);
  return (
    <div className="combat-panel" aria-label="Combat">
      <div className="combat-info">
        <strong>{headline}</strong>
        <span className="combat-detail">{detail}</span>
      </div>
      <DiceRow count={diceCount} />
      <span className="combat-buttons">
        {canRoll ? (
          <button type="button" onClick={onRoll} disabled={busy}>
            Roll
          </button>
        ) : (
          <span className="action-bar-hint">
            Waiting for {pendingCombat.responsibleSeat} to roll…
          </span>
        )}
        <button type="button" className="secondary-action" disabled title="Cards coming soon">
          Play card
        </button>
      </span>
    </div>
  );
}
