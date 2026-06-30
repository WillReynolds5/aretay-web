import { NextRequest, NextResponse } from "next/server";
import { updateCardForSegment } from "@/lib/cards";
import { transcribeFromUrl } from "@/lib/whisper";

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const segmentKey = typeof body.segmentKey === "string" ? body.segmentKey.trim() : "";

  if (!videoUrl) {
    return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
  }

  try {
    const captions = await transcribeFromUrl(videoUrl);

    if (courseId && segmentKey) {
      await updateCardForSegment(courseId, segmentKey, { captions });
    }

    return NextResponse.json({ captions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
