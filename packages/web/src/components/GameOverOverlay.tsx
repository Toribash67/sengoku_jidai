import type { EndReason, SeatId } from "@sengoku-jidai/engine/client";
import { endReasonText } from "./board/gameOver.js";

interface GameOverOverlayProps {
  /** Winner's display name (player name, or the capitalized seat). */
  winnerName: string;
  /** Winner's seat, used to colour the headline. */
  winnerSeat: SeatId;
  /** Why the game ended; null only in the defensive case of a complete game with no reason. */
  endReason: EndReason | null;
  redVp: number;
  blackVp: number;
  onNewGame: () => void;
  onDismiss: () => void;
}

/** Full-screen end-of-game modal. Clicking the backdrop (or "View final board") dismisses it to
 *  reveal the final board; "New game" returns to the start screen. */
export function GameOverOverlay({
  winnerName,
  winnerSeat,
  endReason,
  redVp,
  blackVp,
  onNewGame,
  onDismiss
}: GameOverOverlayProps) {
  return (
    <div
      className="game-over-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Game over"
      onClick={onDismiss}
    >
      {/* Stop propagation so clicks on the card don't dismiss the overlay. */}
      <div className="game-over-card" onClick={(e) => e.stopPropagation()}>
        <p className="game-over-eyebrow">Game over</p>
        <h2 className={`game-over-winner game-over-winner-${winnerSeat}`}>
          <span aria-hidden="true">⚑</span> {winnerName} wins
        </h2>
        {endReason ? <p className="game-over-reason">{endReasonText(endReason)}</p> : null}
        <p className="game-over-score" aria-label={`Final score ${redVp} to ${blackVp}`}>
          <span className="game-over-score-red">{redVp}</span>
          <span className="game-over-score-dash" aria-hidden="true">
            &mdash;
          </span>
          <span className="game-over-score-black">{blackVp}</span>
        </p>
        <div className="game-over-actions">
          <button type="button" onClick={onNewGame}>
            New game
          </button>
          <button type="button" className="secondary-action" onClick={onDismiss}>
            View final board
          </button>
        </div>
      </div>
    </div>
  );
}
