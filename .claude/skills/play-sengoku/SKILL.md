---
name: play-sengoku
description: Play a game of General Orders: Sengoku Jidai against a human, as one seat of an online game, given its invite link. Use when the user runs /play-sengoku <invite-link> or asks Claude to play/join a Sengoku game.
argument-hint: <invite-link>
allowed-tools: Bash(node packages/claude-player/dist/cli.js:*), Bash(corepack pnpm -s build:libs), Read
---

# Play Sengoku Jidai

You are playing one seat of an online game against a human who is using the web app.
You act only through the `sengoku` CLI in this repo. Read `rules.md` (next to this file) once
before your first move.

Always call the CLI as `node packages/claude-player/dist/cli.js …` from the repo root (not via
`pnpm`, which hides the exit codes). Below, `sengoku` is shorthand for that command.

## Setup

1. `corepack pnpm -s build:libs` (builds the CLI; once per session).
2. `sengoku join "<invite-link>" --name Claude`
3. Greet briefly: `sengoku say "Good luck — may your supply lines hold."`

## Turn loop

Repeat until the game is over:

1. `sengoku wait` — blocks up to ~9 min (give the Bash call a 600000 ms timeout). Prints the
   opponent's moves and chat.
   - exit 0 → your turn, go on. exit 3 → still waiting, run `wait` again. exit 2 → game over.
   - exit 6 → the human sent a chat message (printed above). Reply right away with `say` if it
     calls for an answer, then run `wait` again.
2. `sengoku status` — board + numbered orders.
3. Think: threats to your HQ and supply, value stars you can take or defend, commanders left
   for both sides, cards in hand (don't waste them; keep one to reroll a critical combat).
4. `sengoku play <n> [--from A:N,...] [--place A:N,...] [--bonus K]`
   - Combat orders have stable names — use them: `play roll`, `play ambush`, `play reroll:<card>`,
     `play accept`. Their numbers shift between steps (a reroll appears once you hold a card), so
     never repeat a number blindly; read the orders printed after each step.
   - exit 0 → the board after your move is printed; if it still lists orders for you
     (e.g. a combat roll, a decision), continue from step 3; otherwise back to step 1.
   - exit 1 → your arguments were wrong; the message names the limit. Fix and retry.
   - exit 4 → stale or rejected; run `status` and choose again.
   - exit 5 → token rejected; stop and ask the human for a fresh invite link.

Combat rolls you owe (e.g. defending when the human advances) show up as orders on the
human's turn — `wait` returns 0 for them too.

If any command prints "Could not reach the game server" (exit 1), or `wait`/`status` exits with a
code not listed above, wait a moment and run it once more; if it fails again, stop and tell the
human (the server may be redeploying). `wait` itself already retries through brief outages.
`say` accepts at most 500 characters.

## Chat etiquette

- Reply when the human speaks to you; otherwise at most one short line every few turns.
- Never mention area ids (like tile7) in chat — describe places in words
  ("your northern fort", "the river mouth").
- No running commentary on every move, no gloating.

## Game over (exit 2)

Say "gg" plus one line on what decided the game, then tell the human in the terminal who won
and the final VP.
