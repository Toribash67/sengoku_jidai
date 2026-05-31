import type { AreaState } from "../types.js";

export const placeholderMapId = "placeholder-sengoku";

export function createPlaceholderAreas(): Record<string, AreaState> {
  return {
    yamashiro: {
      id: "yamashiro",
      name: "Yamashiro",
      controller: "red",
      commander: "red",
      strength: 2,
      adjacent: ["omi", "yamato"]
    },
    omi: {
      id: "omi",
      name: "Omi",
      controller: null,
      commander: null,
      strength: 1,
      adjacent: ["yamashiro", "mino", "ise"]
    },
    mino: {
      id: "mino",
      name: "Mino",
      controller: "black",
      commander: "black",
      strength: 2,
      adjacent: ["omi", "ise"]
    },
    yamato: {
      id: "yamato",
      name: "Yamato",
      controller: null,
      commander: null,
      strength: 1,
      adjacent: ["yamashiro", "ise"]
    },
    ise: {
      id: "ise",
      name: "Ise",
      controller: null,
      commander: null,
      strength: 1,
      adjacent: ["omi", "mino", "yamato"]
    }
  };
}
