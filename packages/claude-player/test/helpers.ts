import {
  createInitialState,
  playerView,
  type GameState,
  type OperationCard,
  type PlayerGameView
} from "@sengoku-jidai/engine";

/** A fresh Rivers game with `cards` forced into the active seat's hand. */
export function openingState(seed = "cp", cards: OperationCard[] = []): GameState {
  const base = createInitialState({ gameId: "claude-player", seed });
  const seat = base.activeSeat;
  return {
    ...base,
    players: { ...base.players, [seat]: { ...base.players[seat], hand: cards } }
  } as GameState;
}

export function activeView(state: GameState): PlayerGameView {
  return playerView(state, state.activeSeat);
}

/** A view whose legal summary is empty — base for hand-built order fixtures. */
export function emptyLegalView(state: GameState): PlayerGameView {
  const view = activeView(state);
  return {
    ...view,
    legal: {
      ...view.legal,
      canPass: false,
      moves: [],
      strikes: [],
      placements: [],
      plans: [],
      cardPlays: [],
      canRollCombat: false,
      canResolveCombat: false,
      canRerollCombat: false,
      canAmbush: false
    },
    pendingDecision: null,
    pendingCombat: null
  };
}
