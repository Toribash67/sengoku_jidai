import type { OperationCard } from "@sengoku-jidai/engine";
import { cardBack, cardImage, cardLabel } from "./cardImages.js";

interface HandProps {
  /** The viewer's own cards (face-up). */
  hand: OperationCard[];
  /** How many cards the opponent holds (shown face-down). */
  opponentHandCount: number;
  busy: boolean;
  /** When set, cards are clickable to discard for a combat reroll. */
  onDiscard?: (card: OperationCard) => void;
}

/** The viewer's hand of operation cards, plus a face-down count of the opponent's. During a
 *  combat reroll (`onDiscard` set) each card becomes a button that discards it to reroll. */
export function Hand({ hand, opponentHandCount, busy, onDiscard }: HandProps) {
  return (
    <div className="hand-panel">
      <h3 className="detail-subhead">Your cards ({hand.length})</h3>
      {hand.length === 0 ? (
        <p className="muted">No cards. Take a Plan to draw.</p>
      ) : (
        <ul className="hand">
          {hand.map((card, i) => (
            <li key={`${card}-${i}`}>
              {onDiscard ? (
                <button
                  type="button"
                  className="hand-card hand-card-actionable"
                  onClick={() => onDiscard(card)}
                  disabled={busy}
                  title={`Discard ${cardLabel(card)} to reroll`}
                >
                  <img src={cardImage(card)} alt={cardLabel(card)} loading="lazy" />
                </button>
              ) : (
                <span className="hand-card" title={cardLabel(card)}>
                  <img src={cardImage(card)} alt={cardLabel(card)} loading="lazy" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {onDiscard ? <p className="muted">Tap a card to discard it and reroll.</p> : null}
      <p className="muted">
        Opponent holds {opponentHandCount} {opponentHandCount === 1 ? "card" : "cards"}.
      </p>
      {opponentHandCount > 0 ? (
        <ul className="hand hand-opponent" aria-hidden="true">
          {Array.from({ length: opponentHandCount }, (_, i) => (
            <li key={i}>
              <span className="hand-card hand-card-back">
                <img src={cardBack} alt="" loading="lazy" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
