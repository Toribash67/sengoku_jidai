import { useState, type FormEvent } from "react";
import type { SeatId } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

interface ClaimSeatPromptProps {
  seatInfo: GameSeatInfo[];
  viewerSeat: SeatId;
  busy: boolean;
  error: string | null;
  onClaim: (name: string) => void;
}

const sideLabel: Record<SeatId, string> = { red: "Red", black: "Black" };

export function ClaimSeatPrompt({
  seatInfo,
  viewerSeat,
  busy,
  error,
  onClaim
}: ClaimSeatPromptProps) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const host = seatInfo.find((s) => s.seat !== viewerSeat && s.name);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onClaim(trimmed);
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel claim-screen" aria-label="Join game">
        <h1>Join the battle</h1>
        <p className="claim-intro">
          {host ? `${host.name} invited you to play ` : "You've been invited to play "}
          <strong data-seat={viewerSeat}>{sideLabel[viewerSeat]}</strong>.
        </p>
        <form className="create-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Tokugawa"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Joining…" : "Join game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
