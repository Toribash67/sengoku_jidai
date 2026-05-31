export interface RealtimeHub {
  publishView(gameId: string, revision: number): void;
}

export function createNoopRealtimeHub(): RealtimeHub {
  return {
    publishView: () => undefined
  };
}
