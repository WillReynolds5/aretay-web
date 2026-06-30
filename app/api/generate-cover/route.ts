import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/llm";
import { courseCoverKey, getPublicObjectUrl, uploadObject } from "@/lib/r2";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { Curriculum } from "@/lib/curriculum";

export const maxDuration = 300;

function buildCoverPrompt(title: string, subtitle: string | null, description: string | null): string {
  return [
    `Cinematic cover artwork for a learning course titled "${title}".`,
    subtitle ? `Subtitle: "${subtitle}".` : "",
    description ? `The course covers: ${description}` : "",
    "One iconic, instantly readable central subject that captures the course's topic —",
    "a place, object, or landscape, not a person.",
    "Photorealistic, dramatic cinematic lighting, rich color grading, vertical 2:3 poster framing,",
    "highly detailed, atmospheric depth.",
    "No text, no lettering, no logos, no watermarks, no borders.",
    "No prominent human faces — people only as small, distant, indistinct figures if at all.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  try {
    const { client } = getSupabaseAdmin();
    const { data, error } = await client
      .from("courses")
      .select("title, curriculum")
      .eq("id", courseId)
      .is("deleted_at", null)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });

    const curriculum = data.curriculum as Curriculum | null;
    const title = curriculum?.title ?? data.title;

    const image = await generateImage(
      buildCoverPrompt(title, curriculum?.subtitle ?? null, curriculum?.description ?? null),
    );

    const r2Key = courseCoverKey(courseId);
    await uploadObject(r2Key, image.buffer, "image/png");
    const coverUrl = getPublicObjectUrl(r2Key);

    const { error: updateError } = await client
      .from("courses")
      .update({ cover_image_url: coverUrl })
      .eq("id", courseId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ coverUrl, r2Key, costUsd: image.costUsd });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cover generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
