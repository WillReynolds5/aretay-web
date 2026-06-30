import { NextRequest, NextResponse } from "next/server";
import {
  buildCurriculumFromCardsPrompt,
  buildCurriculumPrompt,
  isValidCurriculum,
  parseCurriculumJson,
} from "@/lib/curriculum-prompt";
import type { Curriculum } from "@/lib/curriculum";
import { flattenScripts } from "@/lib/curriculum";
import {
  CURRICULUM_MODELS,
  DEFAULT_CURRICULUM_MODEL,
  isCurriculumModel,
  isFusionCurriculumModel,
} from "@/lib/curriculum-models";
import { extractContent, getOpenRouter } from "@/lib/llm";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const mode = body.mode === "cards" ? "cards" : "scratch";
  const cardsText = typeof body.cardsText === "string" ? body.cardsText.trim() : "";
  const model = isCurriculumModel(body.model) ? body.model : DEFAULT_CURRICULUM_MODEL;

  if (!name) {
    return NextResponse.json({ error: "Course name is required" }, { status: 400 });
  }
  if (mode === "cards" && !cardsText) {
    return NextResponse.json({ error: "Paste cards before generating from cards" }, { status: 400 });
  }

  const prompt = mode === "cards"
    ? buildCurriculumFromCardsPrompt(name, cardsText)
    : buildCurriculumPrompt(name);

  try {
    const openrouter = getOpenRouter();
    const result = await openrouter.chat.send({
      chatRequest: {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        maxTokens: 131072,
        ...(isFusionCurriculumModel(model) && {
          plugins: [
            {
              id: "fusion",
              analysisModels: [...CURRICULUM_MODELS],
            },
          ],
        }),
      },
    });

    const response = extractContent(result);
    const parsed = parseCurriculumJson(response);
    if (!isValidCurriculum(parsed)) {
      return NextResponse.json({ error: "Model returned invalid curriculum JSON" }, { status: 502 });
    }

    const curriculum = parsed as Curriculum;
    const scriptCount = flattenScripts(curriculum).length;

    return NextResponse.json({
      curriculum,
      stats: {
        lessons: curriculum.lessons.length,
        scripts: scriptCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate curriculum";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
