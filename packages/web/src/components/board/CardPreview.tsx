import type { OperationCard } from "@sengoku-jidai/engine";
import { cardImage, cardLabel } from "./cardImages.js";

interface CardPreviewProps {
  card: OperationCard;
  /** When set, the preview offers a discard-to-reroll action for the current combat. */
  canReroll: boolean;
  busy: boolean;
  onDiscard: (card: OperationCard) => void;
  onClose: () => void;
}

/** A full-screen large preview of a single card. Clicking the backdrop (anywhere outside the
 *  card) closes it; during a combat reroll it also offers a discard button. */
export function CardPreview({ card, canReroll, busy, onDiscard, onClose }: CardPreviewProps) {
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
