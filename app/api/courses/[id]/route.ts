import { NextRequest, NextResponse } from "next/server";
import { getCardDataMap, syncCardsForCourse } from "@/lib/cards";
import { enrichScripts } from "@/lib/course-curriculum";
import type { Curriculum } from "@/lib/curriculum";
import { flattenScripts, sanitizeCurriculum } from "@/lib/curriculum";
import { getVideoUrl, objectExists, persistableMediaUrl, resolveMediaUrl, segmentVideoKey } from "@/lib/r2";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const COURSE_COLUMNS =
  "id, title, description, cover_image_url, visibility, is_live, tags, curriculum, created_at, deleted_at";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { client } = getSupabaseAdmin();

    const { data, error } = await client
      .from("courses")
      .select(COURSE_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });

    // Self-heal legacy cover rows that store expired presigned URLs.
    if (data.cover_image_url) {
      const displayUrl = resolveMediaUrl(data.cover_image_url);
      const persisted = persistableMediaUrl(data.cover_image_url);
      if (persisted && persisted !== data.cover_image_url) {
        await client.from("courses").update({ cover_image_url: persisted }).eq("id", id);
        data.cover_image_url = persisted;
      } else if (displayUrl) {
        data.cover_image_url = displayUrl;
      }
    }

    const curriculum = data.curriculum as Curriculum | null;
    if (curriculum?.lessons?.length) {
      try {
        await syncCardsForCourse(id);
        const cardsMap = await getCardDataMap(id);
        const scripts = await enrichScripts(
          id,
          curriculum,
          cardsMap,
          key => getVideoUrl(key),
          async segmentKey => {
            const key = segmentVideoKey(id, segmentKey);
            return (await objectExists(key)) ? key : null;
          },
        );
        data.curriculum = { ...curriculum, scripts };
      } catch (enrichErr) {
        console.error("curriculum enrichment failed:", enrichErr);
        data.curriculum = {
          ...curriculum,
          scripts: flattenScripts(curriculum).map(script => ({
            ...script,
            video_url: null,
            captions: null,
            audio_url: null,
            audio_duration: null,
            board_url: null,
            final_script: null,
            board_prompt: null,
            video_prompt: null,
            costs: null,
          })),
        };
      }
    }

    return NextResponse.json({ course: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load course";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { client } = getSupabaseAdmin();
    const body = await req.json();

    const curriculum =
      body.curriculum != null
        ? sanitizeCurriculum(body.curriculum as Curriculum)
        : null;

    const updates: Record<string, unknown> = {};
    if (curriculum) {
      updates.title = curriculum.title;
      updates.description = curriculum.description;
      updates.tags = curriculum.tags ?? [];
      updates.curriculum = curriculum;
    }
    if (typeof body.is_live === "boolean") {
      updates.is_live = body.is_live;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await client
      .from("courses")
      .update(updates)
      .eq("id", id)
      .is("deleted_at", null);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (curriculum) {
      try {
        await syncCardsForCourse(id);
      } catch (syncErr) {
        console.error("syncCardsForCourse failed:", syncErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update course";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { client } = getSupabaseAdmin();

    const { error } = await client
      .from("courses")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete course";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
