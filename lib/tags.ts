// ------------------------------------------------------------
//  Course tag taxonomy — the single source of truth.
//
//  The curriculum prompt embeds these slugs so the model picks
//  from a fixed vocabulary, and every save path sanitizes
//  against this list. To add a section later, append here:
//  the prompt, validation, and the iOS Explore chips (which
//  read tags off course rows) all follow automatically.
// ------------------------------------------------------------

export type CourseTag = {
  slug: string;
  label: string;
};

export const COURSE_TAGS: CourseTag[] = [
  { slug: "history", label: "History" },
  { slug: "science", label: "Science" },
  { slug: "math", label: "Math" },
  { slug: "technology", label: "Tech" },
  { slug: "language", label: "Languages" },
  { slug: "arts", label: "Arts" },
  { slug: "literature", label: "Literature" },
  { slug: "philosophy", label: "Philosophy" },
  { slug: "geography", label: "Geography" },
  { slug: "space", label: "Space" },
  { slug: "nature", label: "Nature" },
  { slug: "health", label: "Health" },
  { slug: "psychology", label: "Psychology" },
  { slug: "business", label: "Business" },
  { slug: "economics", label: "Economics" },
  { slug: "politics", label: "Politics" },
  { slug: "religion", label: "Religion" },
  { slug: "music", label: "Music" },
  { slug: "sports", label: "Sports" },
  { slug: "food", label: "Food" },
];

export const COURSE_TAG_SLUGS = COURSE_TAGS.map(t => t.slug);

const SLUG_SET = new Set(COURSE_TAG_SLUGS);

/** Max tags a course may carry — keeps the catalog chips meaningful. */
export const MAX_COURSE_TAGS = 3;

/**
 * Coerce arbitrary model/client output into a clean, deduped list of
 * known tag slugs (at most MAX_COURSE_TAGS, in taxonomy-agnostic order
 * of appearance).
 */
export function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim().toLowerCase();
    if (!SLUG_SET.has(slug) || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= MAX_COURSE_TAGS) break;
  }
  return out;
}
