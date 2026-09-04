import { goalAnalysisSchema, type GoalAnalysis } from "@/lib/domain/types";
import { HeuristicGoalAnalyzer } from "@/lib/ai/heuristic-analyzer";
import { validateAuthorization } from "@/lib/safety/authorization";
import { GOAL_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { GoalAnalyzer } from "@/lib/ai/provider";

/**
 * Optional LLM goal analyzer against any OpenAI-compatible chat endpoint.
 * Fails closed to the heuristic analyzer on ANY problem (network, malformed
 * JSON, schema mismatch, unsafe authorization). The LLM never runs during
 * calls — only for initial goal extraction.
 */
export class LlmGoalAnalyzer implements GoalAnalyzer {
  async analyze(input: string): Promise<GoalAnalysis> {
    try {
      const base = process.env.LLM_BASE_URL!.replace(/\/$/, "");
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: GOAL_ANALYSIS_SYSTEM_PROMPT },
            { role: "user", content: input },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`LLM endpoint returned ${res.status}`);
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty completion");
      const parsed = goalAnalysisSchema.parse(JSON.parse(content));
      const authProblems = validateAuthorization(parsed.goal.authorization);
      if (authProblems.length > 0) throw new Error(authProblems.join("; "));
      return { goal: parsed.goal, analyzer: "llm" };
    } catch {
      // Fail closed: deterministic heuristic result beats a broken LLM call.
      return new HeuristicGoalAnalyzer().analyze(input);
    }
  }
}
