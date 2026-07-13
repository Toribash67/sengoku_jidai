import { useEffect, useState } from "react";
import type { AdminGameSummary, AdminSeatSummary } from "@sengoku-jidai/shared";
import { apiErrorMessage, ApiError } from "../client/api.js";
import { deleteAdminGame, fetchAdminGames } from "../client/admin.js";
import { inviteUrl, navigateTo } from "../state/route.js";

const PASSWORD_KEY = "sengoku.adminPassword";

export function AdminScreen() {
  const [password, setPassword] = useState<string | null>(() =>
    sessionStorage.getItem(PASSWORD_KEY)
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [games, setGames] = useState<AdminGameSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function handleUnauthorized() {
    sessionStorage.removeItem(PASSWORD_KEY);
    setPassword(null);
    setGames(null);
    setLoadError("That password was not accepted.");
  }

  async function load(pw: string) {
    setLoadError(null);
    try {
      const response = await fetchAdminGames(pw);
      setGames(response.games);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError(apiErrorMessage(caught));
    }
  }

  useEffect(() => {
    if (password !== null) {
      void load(password);
    }
  }, [password]);

  function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    const pw = passwordInput.trim();
    if (pw.length === 0) {
      return;
    }
    sessionStorage.setItem(PASSWORD_KEY, pw);
    setPasswordInput("");
    setLoadError(null);
    setPassword(pw);
  }

  async function handleDelete(game: AdminGameSummary) {
    if (password === null) {
      return;
    }
    if (
      !window.confirm(`Delete game ${game.id}? This permanently removes it and cannot be undone.`)
    ) {
      return;
    }
    setActionError(null);
    try {
      await deleteAdminGame(password, game.id);
      await load(password);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        handleUnauthorized();
        return;
      }
      setActionError(apiErrorMessage(caught));
    }
  }

  async function handleCopy(seat: AdminSeatSummary, gameId: string) {
    if (seat.token === null) {
      return;
    }
    const link = inviteUrl(window.location.origin, gameId, seat.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(`${gameId}:${seat.seat}`);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  if (password === null) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Admin login">
          <h1>Admin</h1>
          {loadError ? <p className="error-text">{loadError}</p> : null}
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder="Admin password"
              aria-label="Admin password"
              autoFocus
            />
            <button type="submit" className="primary-action">
              Sign in
            </button>
          </form>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            Back to game
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel admin-panel" aria-label="Admin">
        <header className="admin-header">
          <h1>Games</h1>
          <button type="button" className="secondary-action" onClick={() => void load(password)}>
            Refresh
          </button>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            Back to game
          </button>
        </header>
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {loadError ? (
          <p className="error-text">{loadError}</p>
        ) : games === null ? (
          <p className="muted">Loading games…</p>
        ) : games.length === 0 ? (
          <p className="muted">No games.</p>
        ) : (
          <ul className="admin-list">
            {games.map((game) => (
              <li key={game.id} className="admin-row">
                <div className="admin-row-head">
                  <strong>{game.id}</strong>
                  <span className="muted">
                    {game.mode} · {game.status} · rev {game.revision}
                  </span>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => void handleDelete(game)}
                  >
                    Delete
                  </button>
                </div>
                <div className="muted admin-row-meta">
                  created {game.createdAt} · updated {game.updatedAt}
                </div>
                <ul className="admin-seats">
                  {game.seats.map((seat) => (
                    <li key={seat.seat} className="admin-seat">
                      <span>
                        {seat.seat}: {seat.name ?? "—"} ({seat.status})
                      </span>
                      {seat.token === null ? (
                        <span className="muted">link unavailable</span>
                      ) : (
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => void handleCopy(seat, game.id)}
                        >
                          {copied === `${game.id}:${seat.seat}` ? "Copied!" : "Copy invite link"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
