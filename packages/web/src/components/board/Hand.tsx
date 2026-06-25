import type { OperationCard } from "@sengoku-jidai/engine";
import { cardBack, cardImage, cardLabel } from "./cardImages.js";

interface HandProps {
  /** The viewer's own cards (face-up). */
  hand: OperationCard[];
  /** How many cards the opponent holds (shown face-down). */
  opponentHandCount: number;
  /** True while a combat reroll is available (changes the hint shown). */
  canReroll: boolean;
  /** Cards that can be played with a deploying commander right now (badged as playable). */
  playableCards: Set<OperationCard>;
  /** Open a large preview of the clicked card. */
  onPreview: (card: OperationCard) => void;
}

/** The viewer's hand of operation cards, plus a face-down count of the opponent's. Clicking a
 *  card opens a large preview (where it can be played, or discarded to reroll during combat). */
export function Hand({ hand, opponentHandCount, canReroll, playableCards, onPreview }: HandProps) {
  return (
    <div className="hand-panel">
      <h3 className="detail-subhead">Your cards ({hand.length})</h3>
      {hand.length === 0 ? (
        <p className="muted">No cards. Take a Plan to draw.</p>
      ) : (
        <ul className="hand">
          {hand.map((card, i) => {
            const playable = playableCards.has(card);
            return (
              <li key={`${card}-${i}`}>
                <button
                  type="button"
                  className={`hand-card hand-card-actionable${playable ? " hand-card-playable" : ""}`}
                  onClick={() => onPreview(card)}
                  title={`${playable ? "Play" : "Preview"} ${cardLabel(card)}`}
                >
                  <img src={cardImage(card)} alt={cardLabel(card)} loading="lazy" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hand.length > 0 ? (
        <p className="muted">
          {canReroll
            ? "Tap a card to preview and discard it to reroll."
            : playableCards.size > 0
              ? "Glowing cards can be played now — tap to preview and play."
              : "Tap a card to preview."}
        </p>
      ) : null}
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
