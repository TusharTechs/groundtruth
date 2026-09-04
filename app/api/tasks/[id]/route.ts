import { NextResponse } from "next/server";
import { snapshot } from "@/lib/agent/resolver";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const snap = await snapshot(id);
    return NextResponse.json(snap);
  } catch {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
}
