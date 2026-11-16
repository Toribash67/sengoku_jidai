import { AI_THINK_TIMES, type AiThinkTime } from "@sengoku-jidai/shared";

const LABEL: Record<AiThinkTime, string> = {
  quick: "Quick (1.5 s)",
  normal: "Normal (5 s)",
  long: "Long (10 s)"
};

/** The AI thinking-time choices offered when creating a game against the computer, in order. */
export const THINK_TIME_OPTIONS: { value: AiThinkTime; label: string }[] = AI_THINK_TIMES.map(
  (value) => ({ value, label: LABEL[value] })
);
