import { sanitizeTags } from "./tags";

export type CurriculumQuestion = {
  question: string;
  answer: string;
  answer_word_count: number;
};

export type CurriculumSegment = {
  segment_number: number;
  script: string;
  word_count: number;
  questions: CurriculumQuestion[];
};

export type CurriculumLesson = {
  type: "lesson";
  unit_title: string;
  /** Legacy tree-curriculum fields — newer story-arc courses omit them. */
  level?: number;
  parent_unit?: string | null;
  /** Recursive-course fields: level-one lessons expose future paths without generating them yet. */
  depth?: number;
  learning_goal?: string;
  feynman_prompt?: string;
  expansion_paths?: string[];
  order: number;
  segments: CurriculumSegment[];
};

export type CurriculumOutlineUnit = {
  level_1_unit: string;
  summary: string;
  child_units: string[];
};

export type CurriculumIntro = {
  script: string;
  word_count: number;
};

export type Curriculum = {
  title: string;
  subtitle: string;
  description: string;
  /** 1-3 slugs from the fixed taxonomy in lib/tags.ts, most relevant first. */
  tags?: string[];
  intro: CurriculumIntro;
  outline: CurriculumOutlineUnit[];
  lessons: CurriculumLesson[];
  /** Populated by the course detail API after enriching with production data. */
  scripts?: EnrichedScriptFields[];
};

export type EnrichedScriptFields = RenderableScript & {
  video_url: string | null;
  captions: import("@remotion/captions").Caption[] | null;
  audio_url: string | null;
  audio_duration: number | null;
  board_url: string | null;
  /** Narrated script after the ≤15s trim pass (null if never trimmed). */
  final_script: string | null;
  board_prompt: string | null;
  video_prompt: string | null;
  /** Alternate slideshow pipeline: timestamped image prompts (null if unused). */
  slideshow_plan: import("./production").SlideshowSlide[] | null;
  costs: import("./production").ProductionCosts | null;
};

// ------------------------------------------------------------
//  Renderable scripts
//
//  A "script section" is the unit we turn into a video: the intro,
//  plus every segment of every lesson. Each one gets a stable
//  segment key so its generated video + captions can be stored.
// ------------------------------------------------------------

export const INTRO_SEGMENT_KEY = "intro";

export function lessonSegmentKey(lessonOrder: number, segmentNumber: number): string {
  return `L${lessonOrder}-S${segmentNumber}`;
}

export type RenderableScript = {
  segmentKey: string;
  kind: "intro" | "segment";
  script: string;
  /** Lesson order this script belongs to (null for the intro). */
  lessonOrder: number | null;
  /** Lesson unit title (null for the intro). */
  unitTitle: string | null;
  /** Segment number within the lesson (null for the intro). */
  segmentNumber: number | null;
};

export function flattenScripts(curriculum: Curriculum): RenderableScript[] {
  const scripts: RenderableScript[] = [];

  if (curriculum.intro?.script) {
    scripts.push({
      segmentKey: INTRO_SEGMENT_KEY,
      kind: "intro",
      script: curriculum.intro.script,
      lessonOrder: null,
      unitTitle: null,
      segmentNumber: null,
    });
  }

  const lessons = [...(curriculum.lessons ?? [])].sort((a, b) => a.order - b.order);
  for (const lesson of lessons) {
    for (const segment of lesson.segments ?? []) {
      scripts.push({
        segmentKey: lessonSegmentKey(lesson.order, segment.segment_number),
        kind: "segment",
        script: segment.script,
        lessonOrder: lesson.order,
        unitTitle: lesson.unit_title,
        segmentNumber: segment.segment_number,
      });
    }
  }

  return scripts;
}

// ------------------------------------------------------------
//  Spaced-repetition questions
//
//  Flashcard questions live on card rows keyed `L{order}-S{n}-Q{i}`.
// ------------------------------------------------------------

export function questionSegmentKey(
  lessonOrder: number,
  segmentNumber: number,
  questionIndex: number,
): string {
  return `L${lessonOrder}-S${segmentNumber}-Q${questionIndex + 1}`;
}

export type RenderableQuestion = {
  questionKey: string;
  parentSegmentKey: string;
  question: string;
  answer: string;
  lessonOrder: number;
  segmentNumber: number;
  questionIndex: number;
};

export function flattenQuestions(curriculum: Curriculum): RenderableQuestion[] {
  const questions: RenderableQuestion[] = [];
  const lessons = [...(curriculum.lessons ?? [])].sort((a, b) => a.order - b.order);

  for (const lesson of lessons) {
    for (const segment of lesson.segments ?? []) {
      (segment.questions ?? []).forEach((q, i) => {
        questions.push({
          questionKey: questionSegmentKey(lesson.order, segment.segment_number, i),
          parentSegmentKey: lessonSegmentKey(lesson.order, segment.segment_number),
          question: q.question,
          answer: q.answer,
          lessonOrder: lesson.order,
          segmentNumber: segment.segment_number,
          questionIndex: i,
        });
      });
    }
  }

  return questions;
}

export function sanitizeCurriculum(curriculum: Curriculum): Curriculum {
  return {
    title: curriculum.title,
    subtitle: curriculum.subtitle,
    description: curriculum.description,
    tags: sanitizeTags(curriculum.tags),
    intro: curriculum.intro,
    outline: Array.isArray(curriculum.outline) ? curriculum.outline : [],
    lessons: Array.isArray(curriculum.lessons) ? curriculum.lessons : [],
  };
}
