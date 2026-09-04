import type { VerificationGoal } from "@/lib/domain/types";
import { demoScenarios, getScenario } from "@/lib/demo/scenarios";

/**
 * Candidate discovery. The CandidateProvider abstraction keeps the agent
 * decoupled from where candidates come from:
 *
 *  - DemoCandidateProvider: deterministic fictional suppliers (demo default).
 *  - ManualCandidateProvider: numbers the operator supplies explicitly.
 *  - WebCandidateProvider: architecture stub for a future search provider —
 *    deliberately NOT wired to a third-party API for the hackathon so the
 *    demo never depends on unpredictable external results.
 */

export interface CandidateProvider {
  readonly name: string;
  search(goal: VerificationGoal, context?: { scenarioId?: string }): Promise<CandidateInput[]>;
}

export interface CandidateInput {
  name: string;
  phone: string;
  region: string;
  locale: string;
  distanceKm?: number | null;
  address?: string;
}

export class DemoCandidateProvider implements CandidateProvider {
  readonly name = "demo";

  async search(
    goal: VerificationGoal,
    context?: { scenarioId?: string },
  ): Promise<CandidateInput[]> {
    const scenario = getScenario(context?.scenarioId ?? "compressor") ?? demoScenarios[0];
    return scenario.personas.map((p) => ({
      name: p.name,
      phone: p.phone,
      region: p.region,
      locale: p.locale,
      distanceKm: p.distanceKm,
      address: p.address,
    }));
  }
}

export class ManualCandidateProvider implements CandidateProvider {
  readonly name = "manual";

  constructor(private candidates: CandidateInput[]) {}

  async search(): Promise<CandidateInput[]> {
    return this.candidates;
  }
}

/** Stub documenting the contract for a production web-search provider. */
export interface WebCandidateProviderConfig {
  /** e.g. "serpapi" | "google_places" — intentionally unimplemented. */
  engine: string;
  apiKeyEnv: string;
}

export class WebCandidateProvider implements CandidateProvider {
  readonly name = "web";

  constructor(private config: WebCandidateProviderConfig) {}

  async search(_goal: VerificationGoal): Promise<CandidateInput[]> {
    throw new Error(
      `WebCandidateProvider(${this.config.engine}) is an architecture stub. ` +
        `Configure ${this.config.apiKeyEnv} and implement search() before enabling. ` +
        `Use the demo or manual provider for deterministic runs.`,
    );
  }
}

export function defaultProvider(): CandidateProvider {
  return new DemoCandidateProvider();
}
