import { COURSE_TAG_SLUGS, MAX_COURSE_TAGS } from "./tags";

export function buildCurriculumPrompt(subject: string) {
  return `# ROLE

You generate level-one survey courses for Aretay, a learning app where learners watch short narrated videos, explain each module with the Feynman technique, then review atomic facts as spaced-repetition cards.

# INPUT AND SCOPE

The input may be as short as two words ("general relativity") or as long as a paragraph specifying subject, angle, audience, and depth. From whatever you're given, extract:
- **Core subject** — what the course is about
- **Scope** — how wide to cast (a battle vs. an entire era)
- **Audience/level** — beginner, advanced, kids, etc., if stated
- **Angle/emphasis** — any specific framing, inclusions, or exclusions
- **Title** — if one is provided

Rules:
- **Sparse input** (a few words): infer a sensible beginner-friendly survey.
- **Rich input** (a paragraph): honor every constraint the user specified — emphasis, audience, tone, what to include or skip. Do NOT flatten their framing into a generic treatment.
- **Title:** if provided, use it verbatim. If not, generate a clear title and a short subtitle. No clickbait, no stacked colons.
- This is a level-one survey, not the complete course. Give the learner a useful first map of the subject and stop before deep specialization.
- **6-8 lessons, each with 2-4 segments. Hard cap: 24 segments total.**
- Each lesson teaches one explainable idea: 2-4 short segments, 2-4 supporting facts, one clear relationship, and 3-5 review cards. If it needs more than 5 cards, split it.
- Choose the lessons that form the clearest first path through the subject — cut the long tail, keep the spine.
- Set each lesson's \`order\` to its position in the story, starting at 1.

# DOMAIN STRATEGY

Use the right teaching shape for the subject.

**General:** level one is the map and first walk-through. Each lesson includes 2-4 \`expansion_paths\`: small named doors a future premium course can open. Do NOT generate those deeper lessons yet.

**History:** teach the causal spine. Use chronology when it helps, but make every lesson answer "what changed, and why?" Expansion paths can open causes, people, events, primary sources, consequences, and debates.

**Science:** teach the system before the details. Start with what the thing does, then the mechanism, then evidence or use. Expansion paths can open mechanisms, equations, experiments, examples, applications, and edge cases.

**Language:** level one is survival communication, not a tour of grammar. Start with phrases the learner can say on day one: greetings, names, ordering, directions, prices, help, and "I don't understand." Each lesson teaches one real-life exchange. Grammar appears only as a doorway from a useful phrase. Include expansion paths for the grammar hiding inside the phrase, vocabulary families, pronunciation, listening practice, and sentence production. As depth increases, paths may become explicitly structural: full verb conjugations, articles, tense, agreement, noun gender, and high-frequency word families.

# CONTENT RULES

## Intro
- Exactly one segment, no questions, no branding.
- 24-30 words.
- Hook, don't summarize. Open one specific loop that lesson one starts to answer.

## Lessons
- **24-30 words per segment** (fits 15 seconds at a natural, unhurried storytelling pace — the narration is NOT sped up, so respect this budget strictly)
- Short sentences; avoid em-dashes and parentheticals
- Write in a storyteller's register: concrete, sensory, present-tense where it lands. One vivid image per segment that a video can show.
- Use specific proper nouns ("Peloponnesian War", not "the war") so questions can reference them
- Build forward from the previous segment — don't reset context
- No throat-clearing ("Now let's discuss...", "Interestingly...")
- When a beat needs more room, split it across consecutive segments. Continuation segments can have \`"questions": []\`.

## Questions
- **0-2 questions per segment, 3-5 per lesson.** A segment with zero questions is a continuation beat (use \`"questions": []\` — always an array, never null).
- Only quiz facts the narration actually stated.
- Write Anki-style cards: one atomic fact per question, one clear answer, no lists.
- Quiz the hard-to-recall part and supply the easy context. If a date and an obvious noun appear together, ask for the date.
- Don't let the stem give away its own answer.
- **Must be fully standalone.** A learner with zero context should answer them 3 weeks later.
- NO pronouns ("he", "it", "they", "this", "that")
- NO definite articles that assume context ("the war" → "the Peloponnesian War"; "the city" → "Athens")
- Include time, place, and proper-noun anchors
- Vary types across a lesson: when / where / who / what / why / how
- For language courses, prefer production, meaning, situation, contrast, and pronunciation-rule cards. Do not test isolated letters inside example words or abstract grammar labels before the learner can use the phrase.

## Answers
- Short, canonical answers. Usually 1-8 words; longer only when a language card needs a full phrase or sentence.
- One answer only — never a list.
- Prefer names, dates, places, terms, translations, formulas, or crisp causal claims.

# TAGS AND OUTPUT

Classify the course into 1-${MAX_COURSE_TAGS} tags so the app can shelve it. Choose ONLY from this fixed vocabulary, most relevant first:

${COURSE_TAG_SLUGS.join(", ")}

- Use the closest fits — never invent new tags, never output zero tags.
- One tag is fine for a clearly single-domain course; only add a second or third when it genuinely spans domains (e.g. "the physics of music" → ["science", "music"]).

Return ONE valid JSON object, no prose, no commentary, no markdown fences.

The \`outline\` groups lessons into 2-4 acts. (The field names are legacy: \`level_1_unit\` holds the ACT title, \`child_units\` holds that act's lesson titles in story order.)

{
  "title": "string",
  "subtitle": "string",
  "description": "string (normalized one-line scope of the course)",
  "tags": ["string (from the fixed tag vocabulary, most relevant first)"],
  "intro": {
    "script": "string",
    "word_count": 0
  },
  "outline": [
    {
      "level_1_unit": "string (act title)",
      "summary": "string (what happens in this act)",
      "child_units": ["string (lesson titles, in order)"]
    }
  ],
  "lessons": [
    {
      "type": "lesson",
      "unit_title": "string (lesson title)",
      "depth": 1,
      "learning_goal": "string (the one idea the learner should be able to explain)",
      "feynman_prompt": "string (ask the learner to explain the lesson in plain language)",
      "expansion_paths": ["string (future deeper lesson path)"],
      "order": 1,
      "segments": [
        {
          "segment_number": 1,
          "script": "string",
          "word_count": 0,
          "questions": [
            {"question": "string", "answer": "string", "answer_word_count": 0}
          ]
        }
      ]
    }
  ]
}

# REFERENCE EXAMPLES

These are slices, not full outputs. They show the shape of good lessons and review cards across domains.

History input: "ancient greece"
- Lesson: "The Long Silence"
- Learning goal: "Explain how the Greek Dark Age set up Greece's later return to writing and public life."
- Feynman prompt: "Explain why the Greek Dark Age matters to the story of ancient Greece."
- Expansion paths: ["How the Bronze Age collapse reached Greece", "How the Phoenician alphabet changed Greek life", "Why written laws mattered for Greek city-states"]
- Script: "Around 1200 BCE, Greek palace civilization collapsed. Palaces burned, trade shrank, and writing vanished. Historians call the next four centuries the Greek Dark Age."
- Question: "What period followed the collapse of Greek palace civilization around 1200 BCE?"
- Answer: "Greek Dark Age"

Science input: "photosynthesis"
- Lesson: "The Sugar Factory"
- Learning goal: "Explain how plants use light energy to make sugar."
- Feynman prompt: "Explain photosynthesis as if you were describing how a plant feeds itself."
- Expansion paths: ["How chlorophyll captures light", "Why plants split water", "How carbon dioxide becomes glucose", "What limits photosynthesis"]
- Script: "Inside chloroplasts, plants use sunlight to split water and move electrons. That energy helps turn carbon dioxide into glucose, the sugar plants live on."
- Question: "What plant cell structure uses sunlight to power photosynthesis?"
- Answer: "Chloroplasts"
- Question: "What sugar do plants make from carbon dioxide during photosynthesis?"
- Answer: "Glucose"

Language input: "beginner italian"
- Lesson: "Order a Coffee"
- Learning goal: "Order one item politely in an Italian cafe."
- Feynman prompt: "Explain how to ask for a coffee, say please, and ask for the bill."
- Expansion paths: ["Cafe nouns and drinks", "Un and una with food words", "Vorrei and the verb volere", "Polite requests beyond vorrei"]
- Script: "At a cafe, start simple: Vorrei un caffè, per favore. That means I would like a coffee, please. When you finish, ask: il conto?"
- Question: "How do you say I would like a coffee in Italian?"
- Answer: "Vorrei un caffè"
- Question: "What does per favore mean in Italian?"
- Answer: "Please"
- Question: "What Italian phrase asks for the bill?"
- Answer: "Il conto?"

# INPUT

${subject}

Generate the survey course.`;
}

export function buildCurriculumFromCardsPrompt(courseName: string, cardsText: string) {
  return `# ROLE

You turn a pasted flashcard deck into an Aretay course. Aretay learners watch short narrated videos, explain each module with the Feynman technique, then review the exact flashcards as spaced-repetition cards.

# TASK

Create a course in the same JSON format as a generated Aretay curriculum.

Rules:
- Use the provided course name as the title unless the cards clearly contain a better explicit title.
- Parse the pasted cards into question/answer pairs. Accept common text formats: "question -> answer", "question: answer", tab-separated, CSV-ish, numbered lists, or Anki-style front/back lines.
- Preserve every provided card exactly once unless it is an exact duplicate.
- Do not invent new review cards.
- You may lightly clean spelling, punctuation, or wording, but do not change the fact being tested.
- Group related cards into lessons. Each lesson should teach the context needed for 3-6 cards.
- Write 2-4 short lesson segments that explain the cards before they are reviewed.
- If the deck is large, use as many lessons as needed; completeness beats the usual survey-course length cap.
- Each lesson still gets \`depth: 1\`, \`learning_goal\`, \`feynman_prompt\`, and 2-4 \`expansion_paths\`.
- Expansion paths should point to deeper study, not extra cards from the pasted deck.

# CONTENT RULES

## Intro
- Exactly one segment, no questions, no branding.
- 24-30 words.
- Hook the learner into why this deck matters.

## Lessons
- 24-30 words per segment.
- Short sentences; avoid em-dashes and parentheticals.
- Teach the relationship between the cards, not just a list of answers.
- A segment can have \`"questions": []\` when it is setting context.

## Questions
- Use the pasted cards as the source of truth.
- Questions must be standalone.
- Answers must be short and canonical.
- For language cards, prefer production, meaning, situation, contrast, and pronunciation-rule cards.

# TAGS AND OUTPUT

Classify the course into 1-${MAX_COURSE_TAGS} tags. Choose ONLY from this fixed vocabulary, most relevant first:

${COURSE_TAG_SLUGS.join(", ")}

Return ONE valid JSON object, no prose, no commentary, no markdown fences.

The \`outline\` groups lessons into 2-4 acts. (The field names are legacy: \`level_1_unit\` holds the ACT title, \`child_units\` holds that act's lesson titles in story order.)

{
  "title": "string",
  "subtitle": "string",
  "description": "string (normalized one-line scope of the card deck)",
  "tags": ["string (from the fixed tag vocabulary, most relevant first)"],
  "intro": {
    "script": "string",
    "word_count": 0
  },
  "outline": [
    {
      "level_1_unit": "string (act title)",
      "summary": "string (what happens in this act)",
      "child_units": ["string (lesson titles, in order)"]
    }
  ],
  "lessons": [
    {
      "type": "lesson",
      "unit_title": "string (lesson title)",
      "depth": 1,
      "learning_goal": "string (what this card cluster teaches)",
      "feynman_prompt": "string (ask the learner to explain the cluster in plain language)",
      "expansion_paths": ["string (future deeper study path)"],
      "order": 1,
      "segments": [
        {
          "segment_number": 1,
          "script": "string",
          "word_count": 0,
          "questions": [
            {"question": "string", "answer": "string", "answer_word_count": 0}
          ]
        }
      ]
    }
  ]
}

# COURSE NAME

${courseName}

# PASTED CARDS

${cardsText}

Generate the course from these cards.`;
}

export function parseCurriculumJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Model returned an empty response — try again");
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;
  if (!jsonText) {
    throw new Error("Model response had no JSON content — try again");
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error("Model returned malformed JSON — response may have been cut off. Try again.");
  }
}

export function isValidCurriculum(value: unknown): value is import("./curriculum").Curriculum {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.title === "string" &&
    typeof c.subtitle === "string" &&
    typeof c.description === "string" &&
    c.intro != null &&
    typeof (c.intro as Record<string, unknown>).script === "string" &&
    Array.isArray(c.outline) &&
    Array.isArray(c.lessons) &&
    c.lessons.length > 0
  );
}
