import type { OperationCard } from "@sengoku-jidai/engine";
import { cardImage, cardLabel } from "./cardImages.js";

interface CardPreviewProps {
  card: OperationCard;
  /** When set, the preview offers a discard-to-reroll action for the current combat. */
  canReroll: boolean;
  /** When set, the card can be played with a deploying commander right now. */
  canPlay: boolean;
  busy: boolean;
  onDiscard: (card: OperationCard) => void;
  onPlay: (card: OperationCard) => void;
  onClose: () => void;
}

/** A full-screen large preview of a single card. Clicking the backdrop (anywhere outside the
 *  card) closes it; it also offers Play (when deployable) or Discard-to-reroll (during combat). */
export function CardPreview({
  card,
  canReroll,
  canPlay,
  busy,
  onDiscard,
  onPlay,
  onClose
}: CardPreviewProps) {
  return (
    <div
      className="card-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${cardLabel(card)} card`}
      onClick={onClose}
    >
      {/* Stop propagation so clicks on the card/controls don't close the overlay. */}
      <div className="card-preview-body" onClick={(e) => e.stopPropagation()}>
        <img className="card-preview-img" src={cardImage(card)} alt={cardLabel(card)} />
        <div className="card-preview-actions">
          {canPlay ? (
            <button type="button" onClick={() => onPlay(card)} disabled={busy}>
              Play {cardLabel(card)}
            </button>
          ) : null}
          {canReroll ? (
            <button type="button" onClick={() => onDiscard(card)} disabled={busy}>
              Discard to reroll
            </button>
          ) : null}
          <button type="button" className="secondary-action" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
