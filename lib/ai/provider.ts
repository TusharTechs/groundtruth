import { HeuristicGoalAnalyzer } from "@/lib/ai/heuristic-analyzer";
import { LlmGoalAnalyzer } from "@/lib/ai/llm-analyzer";
import type { GoalAnalysis } from "@/lib/domain/types";

/**
 * Goal analyzer provider abstraction. GroundTruth is not coupled to any LLM:
 *  - HeuristicGoalAnalyzer (default): deterministic, dependency-free, and the
 *    reason the demo scenario always behaves identically.
 *  - LlmGoalAnalyzer (optional): any OpenAI-compatible endpoint via
 *    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL, used only to improve extraction.
 *    Its output is validated against the same Zod schema and the same safety
 *    rules as the heuristic path, and it fails closed to the heuristic.
 */
export interface GoalAnalyzer {
  analyze(input: string): Promise<GoalAnalysis>;
}

export function getGoalAnalyzer(): GoalAnalyzer {
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    return new LlmGoalAnalyzer();
  }
  return new HeuristicGoalAnalyzer();
}
