import { z } from "zod";
export declare const seatIdSchema: z.ZodEnum<["red", "black"]>;
export declare const gameModeSchema: z.ZodEnum<["hotseat", "private_multiplayer", "async_multiplayer"]>;
/** The Rivers operation-card ids (must match the engine's OperationCard union). */
export declare const operationCardSchema: z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>;
export declare const pendingChoiceSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    label: string;
}, {
    id: string;
    label: string;
}>;
export declare const commandSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"advance">;
    spaceId: z.ZodString;
    moves: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        from: string;
        count: number;
    }, {
        from: string;
        count: number;
    }>, "many">;
    card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
    cardBonus: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "advance";
    spaceId: string;
    moves: {
        from: string;
        count: number;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    cardBonus?: number | undefined;
}, {
    type: "advance";
    spaceId: string;
    moves: {
        from: string;
        count: number;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    cardBonus?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sail">;
    spaceId: z.ZodString;
    moves: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        from: string;
        count: number;
    }, {
        from: string;
        count: number;
    }>, "many">;
    card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
    cardBonus: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "sail";
    spaceId: string;
    moves: {
        from: string;
        count: number;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    cardBonus?: number | undefined;
}, {
    type: "sail";
    spaceId: string;
    moves: {
        from: string;
        count: number;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    cardBonus?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"bombard">;
    spaceId: z.ZodString;
    targetAreaId: z.ZodString;
    card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
}, "strip", z.ZodTypeAny, {
    type: "bombard";
    spaceId: string;
    targetAreaId: string;
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}, {
    type: "bombard";
    spaceId: string;
    targetAreaId: string;
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"shell">;
    spaceId: z.ZodString;
    targetAreaId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "shell";
    spaceId: string;
    targetAreaId: string;
}, {
    type: "shell";
    spaceId: string;
    targetAreaId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"reinforce">;
    spaceId: z.ZodString;
    placements: z.ZodArray<z.ZodObject<{
        area: z.ZodString;
        count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        count: number;
        area: string;
    }, {
        count: number;
        area: string;
    }>, "many">;
    card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
}, "strip", z.ZodTypeAny, {
    type: "reinforce";
    spaceId: string;
    placements: {
        count: number;
        area: string;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}, {
    type: "reinforce";
    spaceId: string;
    placements: {
        count: number;
        area: string;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"embark">;
    spaceId: z.ZodString;
    placements: z.ZodArray<z.ZodObject<{
        area: z.ZodString;
        count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        count: number;
        area: string;
    }, {
        count: number;
        area: string;
    }>, "many">;
    card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
}, "strip", z.ZodTypeAny, {
    type: "embark";
    spaceId: string;
    placements: {
        count: number;
        area: string;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}, {
    type: "embark";
    spaceId: string;
    placements: {
        count: number;
        area: string;
    }[];
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"plan">;
    spaceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "plan";
    spaceId: string;
}, {
    type: "plan";
    spaceId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"pass">;
}, "strip", z.ZodTypeAny, {
    type: "pass";
}, {
    type: "pass";
}>, z.ZodObject<{
    type: z.ZodLiteral<"combatRoll">;
    pendingId: z.ZodString;
    card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
}, "strip", z.ZodTypeAny, {
    type: "combatRoll";
    pendingId: string;
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}, {
    type: "combatRoll";
    pendingId: string;
    card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"combatReroll">;
    pendingId: z.ZodString;
    card: z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>;
}, "strip", z.ZodTypeAny, {
    type: "combatReroll";
    card: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
    pendingId: string;
}, {
    type: "combatReroll";
    card: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
    pendingId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"combatResolve">;
    pendingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "combatResolve";
    pendingId: string;
}, {
    type: "combatResolve";
    pendingId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"choosePendingDecision">;
    pendingId: z.ZodString;
    choice: z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        label: string;
    }, {
        id: string;
        label: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "choosePendingDecision";
    pendingId: string;
    choice: {
        id: string;
        label: string;
    };
}, {
    type: "choosePendingDecision";
    pendingId: string;
    choice: {
        id: string;
        label: string;
    };
}>]>;
export declare const createGameRequestSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<["hotseat", "private_multiplayer", "async_multiplayer"]>>;
    seed: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    side: z.ZodOptional<z.ZodEnum<["red", "black"]>>;
}, "strip", z.ZodTypeAny, {
    mode: "hotseat" | "private_multiplayer" | "async_multiplayer";
    seed?: string | undefined;
    name?: string | undefined;
    side?: "red" | "black" | undefined;
}, {
    mode?: "hotseat" | "private_multiplayer" | "async_multiplayer" | undefined;
    seed?: string | undefined;
    name?: string | undefined;
    side?: "red" | "black" | undefined;
}>;
export declare const claimGameRequestSchema: z.ZodObject<{
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
}, {
    name: string;
}>;
export declare const submitCommandRequestSchema: z.ZodObject<{
    baseRevision: z.ZodNumber;
    clientCommandId: z.ZodString;
    command: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"advance">;
        spaceId: z.ZodString;
        moves: z.ZodArray<z.ZodObject<{
            from: z.ZodString;
            count: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            from: string;
            count: number;
        }, {
            from: string;
            count: number;
        }>, "many">;
        card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
        cardBonus: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "advance";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    }, {
        type: "advance";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"sail">;
        spaceId: z.ZodString;
        moves: z.ZodArray<z.ZodObject<{
            from: z.ZodString;
            count: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            from: string;
            count: number;
        }, {
            from: string;
            count: number;
        }>, "many">;
        card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
        cardBonus: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "sail";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    }, {
        type: "sail";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"bombard">;
        spaceId: z.ZodString;
        targetAreaId: z.ZodString;
        card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "bombard";
        spaceId: string;
        targetAreaId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }, {
        type: "bombard";
        spaceId: string;
        targetAreaId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"shell">;
        spaceId: z.ZodString;
        targetAreaId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "shell";
        spaceId: string;
        targetAreaId: string;
    }, {
        type: "shell";
        spaceId: string;
        targetAreaId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"reinforce">;
        spaceId: z.ZodString;
        placements: z.ZodArray<z.ZodObject<{
            area: z.ZodString;
            count: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            count: number;
            area: string;
        }, {
            count: number;
            area: string;
        }>, "many">;
        card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "reinforce";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }, {
        type: "reinforce";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"embark">;
        spaceId: z.ZodString;
        placements: z.ZodArray<z.ZodObject<{
            area: z.ZodString;
            count: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            count: number;
            area: string;
        }, {
            count: number;
            area: string;
        }>, "many">;
        card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "embark";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }, {
        type: "embark";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"plan">;
        spaceId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "plan";
        spaceId: string;
    }, {
        type: "plan";
        spaceId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"pass">;
    }, "strip", z.ZodTypeAny, {
        type: "pass";
    }, {
        type: "pass";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"combatRoll">;
        pendingId: z.ZodString;
        card: z.ZodOptional<z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "combatRoll";
        pendingId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }, {
        type: "combatRoll";
        pendingId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"combatReroll">;
        pendingId: z.ZodString;
        card: z.ZodEnum<["ambush", "commandeer", "counterattack", "ground_assault", "mobilise", "river_assault", "ship_strike", "shore_strike"]>;
    }, "strip", z.ZodTypeAny, {
        type: "combatReroll";
        card: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
        pendingId: string;
    }, {
        type: "combatReroll";
        card: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
        pendingId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"combatResolve">;
        pendingId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "combatResolve";
        pendingId: string;
    }, {
        type: "combatResolve";
        pendingId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"choosePendingDecision">;
        pendingId: z.ZodString;
        choice: z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            label: string;
        }, {
            id: string;
            label: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "choosePendingDecision";
        pendingId: string;
        choice: {
            id: string;
            label: string;
        };
    }, {
        type: "choosePendingDecision";
        pendingId: string;
        choice: {
            id: string;
            label: string;
        };
    }>]>;
}, "strip", z.ZodTypeAny, {
    baseRevision: number;
    clientCommandId: string;
    command: {
        type: "advance";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    } | {
        type: "sail";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    } | {
        type: "bombard";
        spaceId: string;
        targetAreaId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "shell";
        spaceId: string;
        targetAreaId: string;
    } | {
        type: "reinforce";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "embark";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "plan";
        spaceId: string;
    } | {
        type: "pass";
    } | {
        type: "combatRoll";
        pendingId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "combatReroll";
        card: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
        pendingId: string;
    } | {
        type: "combatResolve";
        pendingId: string;
    } | {
        type: "choosePendingDecision";
        pendingId: string;
        choice: {
            id: string;
            label: string;
        };
    };
}, {
    baseRevision: number;
    clientCommandId: string;
    command: {
        type: "advance";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    } | {
        type: "sail";
        spaceId: string;
        moves: {
            from: string;
            count: number;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
        cardBonus?: number | undefined;
    } | {
        type: "bombard";
        spaceId: string;
        targetAreaId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "shell";
        spaceId: string;
        targetAreaId: string;
    } | {
        type: "reinforce";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "embark";
        spaceId: string;
        placements: {
            count: number;
            area: string;
        }[];
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "plan";
        spaceId: string;
    } | {
        type: "pass";
    } | {
        type: "combatRoll";
        pendingId: string;
        card?: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike" | undefined;
    } | {
        type: "combatReroll";
        card: "ambush" | "commandeer" | "counterattack" | "ground_assault" | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
        pendingId: string;
    } | {
        type: "combatResolve";
        pendingId: string;
    } | {
        type: "choosePendingDecision";
        pendingId: string;
        choice: {
            id: string;
            label: string;
        };
    };
}>;
export declare const eventQuerySchema: z.ZodObject<{
    after: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    after: number;
}, {
    after?: number | undefined;
}>;
export declare const gameParamsSchema: z.ZodObject<{
    gameId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    gameId: string;
}, {
    gameId: string;
}>;
export declare const authHeaderSchema: z.ZodObject<{
    authorization: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    authorization?: string | undefined;
}, {
    authorization?: string | undefined;
}>;
export type SeatIdDto = z.infer<typeof seatIdSchema>;
export type GameModeDto = z.infer<typeof gameModeSchema>;
export type CommandDto = z.infer<typeof commandSchema>;
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;
export type SubmitCommandRequest = z.infer<typeof submitCommandRequestSchema>;
export type ClaimGameRequest = z.infer<typeof claimGameRequestSchema>;
