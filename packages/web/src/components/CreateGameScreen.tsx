import { useState, type FormEvent } from "react";
import type { SeatId } from "@sengoku-jidai/engine";

interface CreateGameScreenProps {
  busy: boolean;
  error: string | null;
  onCreate: (name: string, side: SeatId) => void;
}

const SIDES: { id: SeatId; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "black", label: "Black" }
];

export function CreateGameScreen({ busy, error, onCreate }: CreateGameScreenProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<SeatId>("red");
  const trimmed = name.trim();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onCreate(trimmed, side);
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel create-screen" aria-label="Create game">
        <h1>General Orders: Sengoku Jidai</h1>
        <form className="create-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Nobunaga"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <fieldset className="side-toggle">
            <legend>Your side</legend>
            {SIDES.map((option) => (
              <button
                key={option.id}
                type="button"
                data-side={option.id}
                aria-pressed={side === option.id}
                className={side === option.id ? "is-active" : ""}
                onClick={() => setSide(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>

          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Creating…" : "Create game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
