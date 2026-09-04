import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask } from "@/lib/agent/resolver";
import { getStore } from "@/lib/db";
import { demoScenarios } from "@/lib/demo/scenarios";

export const dynamic = "force-dynamic";

const createTaskBody = z.object({
  input: z.string().min(10).max(2000),
  scenarioId: z.string().optional(),
});

export async function GET() {
  const tasks = await getStore().listTasks(20);
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createTaskBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "input must be a string of 10-2000 characters", scenarioId: "optional demo scenario id" },
      { status: 400 },
    );
  }
  try {
    const task = await createTask({ input: parsed.data.input, scenarioId: parsed.data.scenarioId });
    return NextResponse.json(
      {
        task,
        scenarios: demoScenarios.map((s) => ({ id: s.id, title: s.title })),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task creation failed";
    const status = message.includes("authorization") ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
