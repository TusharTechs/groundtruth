import { randomUUID } from "node:crypto";
import type { Candidate, VerificationGoal } from "@/lib/domain/types";
import type { CandidateProvider } from "@/lib/discovery/providers";
import { defaultProvider } from "@/lib/discovery/providers";

/**
 * Candidate discovery facade: runs the configured provider, ranks candidates
 * by (distance within goal geography, provider order), persists them, and
 * caps the list at the plan's candidateLimit.
 */
export async function discoverCandidates(
  taskId: string,
  goal: VerificationGoal,
  provider: CandidateProvider = defaultProvider(),
  options?: { scenarioId?: string; limit?: number },
): Promise<Candidate[]> {
  const found = await provider.search(goal, { scenarioId: options?.scenarioId });
  const distanceConstraint = goal.hardConstraints.find((c) => c.kind === "distance_max");
  const maxDistance = distanceConstraint ? Number(distanceConstraint.params.max) : null;

  const ranked = found
    .map((input, index) => {
      // Distance priority: in-radius candidates first, then by distance.
      let priority = index;
      if (maxDistance !== null && input.distanceKm != null) {
        priority = input.distanceKm <= maxDistance ? index : 1000 + index;
      }
      return { input, priority };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, options?.limit ?? 6);

  return ranked.map(({ input, priority }) => ({
    id: randomUUID(),
    taskId,
    name: input.name,
    phone: input.phone,
    region: input.region,
    locale: input.locale,
    distanceKm: input.distanceKm ?? null,
    address: input.address,
    provider: provider.name as Candidate["provider"],
    priority,
    status: "pending" as const,
  }));
}
