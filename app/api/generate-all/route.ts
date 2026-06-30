import { NextRequest, NextResponse } from "next/server";
import { cancelBulkJob, getBulkJob, startBulkJob } from "@/lib/bulk-job";

// Job state endpoints are instant; the actual generation runs detached
// inside the server process (see lib/bulk-job.ts).

export async function POST(req: NextRequest) {
  const body = await req.json();
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const videoRetries = Number.isInteger(body.videoRetries) ? (body.videoRetries as number) : 4;

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  try {
    const { job, alreadyRunning } = await startBulkJob(courseId, req.nextUrl.origin, videoRetries);
    return NextResponse.json({ job, alreadyRunning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start bulk generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get("courseId")?.trim() ?? "";
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }
  return NextResponse.json({ job: getBulkJob(courseId) });
}

export async function DELETE(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get("courseId")?.trim() ?? "";
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }
  return NextResponse.json({ job: cancelBulkJob(courseId) });
}
