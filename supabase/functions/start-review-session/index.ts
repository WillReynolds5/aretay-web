// start-review-session edge function (RFC 001 §7.6).
//
// Verifies the caller's JWT, loads their DUE question cards for a course,
// builds a manifest (question + canonical answer) from the course curriculum,
// creates an `active`
// review_sessions row, and mints a short-TTL EPHEMERAL Gemini Live token so the
// device can connect directly to the Live API without ever seeing the
// long-lived GEMINI_API_KEY. Grading is generic — the agent judges the spoken
// answer against the canonical answer using its system-instruction rules.
//
// Request:  { courseId: string, cardIds?: string[], reviewLimit?: number }
//           `cardIds` scopes the review to exactly those cards (a section's
//           just-watched questions, the immediate per-section review). Omit it
//           for the opening review, which grades the due queue up to the
//           configured review limit.
// Response: { sessionId, token, model, manifest: [{ cardId, segmentKey,
//             question, answer }] }
//
// NOTE (Phase 0 validation): the ephemeral-token API shape for Gemini Live is a
// preview surface — the endpoint/version and request body below must be
// confirmed in the spike (RFC §11.1, §6.2). Both the model id and API version
// are env-configurable so they can change without a code edit.

import { authenticate, guardMethod, json } from '../_shared/lib.ts'

// ── curriculum → question map (mirrors aretay-admin/lib/curriculum.ts) ───────

type CurriculumQuestion = { question: string; answer: string }
type CurriculumSegment = { segment_number: number; questions?: CurriculumQuestion[] }
type CurriculumLesson = { order: number; segments?: CurriculumSegment[] }
type Curriculum = { title?: string; subtitle?: string; lessons?: CurriculumLesson[] }

type QuestionInfo = { question: string; answer: string }

function questionKey(lessonOrder: number, segmentNumber: number, questionIndex: number): string {
  return `L${lessonOrder}-S${segmentNumber}-Q${questionIndex + 1}`
}

/** segment_key → { question, answer } for every flashcard in the curriculum. */
function buildQuestionMap(curriculum: Curriculum): Map<string, QuestionInfo> {
  const map = new Map<string, QuestionInfo>()
  const lessons = [...(curriculum.lessons ?? [])].sort((a, b) => a.order - b.order)
  for (const lesson of lessons) {
    for (const segment of lesson.segments ?? []) {
      ;(segment.questions ?? []).forEach((q, i) => {
        map.set(questionKey(lesson.order, segment.segment_number, i), {
          question: q.question,
          answer: q.answer,
        })
      })
    }
  }
  return map
}

const DEFAULT_REVIEW_LIMIT = 5

function parseReviewLimit(raw: unknown, label: string): number {
  const limit = typeof raw === 'string' ? Number(raw) : raw
  if (!Number.isInteger(limit) || (limit as number) < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return limit as number
}

// ── ephemeral Gemini Live token ──────────────────────────────────────────────

async function mintLiveToken(): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  const apiVersion = Deno.env.get('GEMINI_API_VERSION') ?? 'v1alpha'

  const now = Date.now()
  // Mint an UNCONSTRAINED token (no `bidiGenerateContentSetup`, no `fieldMask`).
  // Per the Live API docs, when both are omitted the effective setup is taken
  // from the client's WebSocket `setup` message — which is required here, since
  // the device sends the per-session system instruction (card manifest + rubric)
  // and the grade_card/next_card/end_session tool declarations. Locking the model
  // server-side via `bidiGenerateContentSetup` would discard that client setup.
  // (`liveConnectConstraints` is only a @google/genai SDK alias and the raw REST
  // endpoint rejects it with "Invalid JSON payload / Unknown name".)
  const body = {
    uses: 1,
    // Token can be used to OPEN a session within ~1 min; the session itself may
    // run up to expireTime (~30 min).
    expireTime: new Date(now + 30 * 60_000).toISOString(),
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/${apiVersion}/auth_tokens?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Gemini token mint failed (${res.status}): ${detail}`)
  }

  const data = await res.json()
  // The ephemeral token is the resource name, e.g. "auth_tokens/abc123".
  const token = data?.name
  if (typeof token !== 'string') throw new Error('Gemini token response missing name')
  return token
}

// ── handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const guard = guardMethod(req)
  if (guard) return guard

  const ctx = await authenticate(req)
  if (ctx instanceof Response) return ctx
  const { userId, admin } = ctx

  let courseId: string
  let cardIds: string[] | null = null
  let reviewLimit = DEFAULT_REVIEW_LIMIT
  try {
    const parsed = await req.json()
    courseId = parsed?.courseId
    if (!courseId || typeof courseId !== 'string') throw new Error('courseId required')
    reviewLimit = parsed?.reviewLimit == null
      ? parseReviewLimit(Deno.env.get('REVIEW_CARD_LIMIT') ?? DEFAULT_REVIEW_LIMIT, 'REVIEW_CARD_LIMIT')
      : parseReviewLimit(parsed.reviewLimit, 'reviewLimit')
    // Optional scope: a specific set of cards to review (a section's questions).
    if (parsed?.cardIds != null) {
      if (!Array.isArray(parsed.cardIds) || parsed.cardIds.some((id: unknown) => typeof id !== 'string')) {
        throw new Error('cardIds must be an array of strings')
      }
      cardIds = parsed.cardIds as string[]
      if (cardIds.length === 0) return json({ error: 'No cards are due for this course' }, 409)
    }
  } catch (e) {
    return json({ error: 'Invalid request body', detail: (e as Error).message }, 400)
  }

  const model = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-3.1-flash-live-preview'

  // 1. Due cards for this user/course: every tracked card past due, INCLUDING
  //    'new' (a segment watched but never graded). The voice agent is the single
  //    grading path now, so it conducts first reviews too — there is no MC step.
  //    When `cardIds` is supplied, scope to those cards (the immediate review of
  //    the section just watched); otherwise grade the oldest due queue. In both
  //    cases, cap the session so a voice review stays bite-sized.
  const nowIso = new Date().toISOString()
  let dueQuery = admin
    .from('card_states')
    .select('card_id, due')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .lte('due', nowIso)
    .order('due', { ascending: true })
    .limit(reviewLimit)
  if (cardIds) dueQuery = dueQuery.in('card_id', cardIds)
  const { data: states, error: statesError } = await dueQuery

  if (statesError) return json({ error: 'Failed to load due cards', detail: statesError.message }, 500)
  if (!states?.length) return json({ error: 'No cards are due for this course' }, 409)

  const dueCardIds = states.map(s => s.card_id)

  // 2. Card rows (segment key).
  const { data: cards, error: cardsError } = await admin
    .from('cards')
    .select('id, segment_key')
    .in('id', dueCardIds)
    .is('deleted_at', null)

  if (cardsError) return json({ error: 'Failed to load cards', detail: cardsError.message }, 500)

  // 3. Curriculum → question/answer text.
  const { data: course, error: courseError } = await admin
    .from('courses')
    .select('curriculum')
    .eq('id', courseId)
    .single()

  if (courseError || !course) {
    return json({ error: 'Course not found', detail: courseError?.message }, 404)
  }
  const questionMap = buildQuestionMap((course.curriculum ?? {}) as Curriculum)

  // 4. Assemble the manifest in due order.
  const cardById = new Map((cards ?? []).map(c => [c.id, c]))
  const manifest = []
  for (const state of states) {
    const card = cardById.get(state.card_id)
    if (!card?.segment_key) continue
    const q = questionMap.get(card.segment_key)
    if (!q) continue // not a question card (or curriculum drift) — skip
    manifest.push({
      cardId: card.id,
      segmentKey: card.segment_key,
      question: q.question,
      answer: q.answer,
    })
  }

  if (!manifest.length) return json({ error: 'No reviewable question cards are due' }, 409)

  // 5. Create the session row before minting the token (so a mint failure still
  //    leaves an auditable 'active' row the client can finish/abandon).
  const { data: session, error: sessionError } = await admin
    .from('review_sessions')
    .insert({
      user_id: userId,
      course_id: courseId,
      scheduler: 'fsrs5',
      status: 'active',
      card_count: manifest.length,
    })
    .select('id')
    .single()

  if (sessionError || !session) {
    return json({ error: 'Failed to create review session', detail: sessionError?.message }, 500)
  }

  // 6. Mint the ephemeral Live token.
  let token: string
  try {
    token = await mintLiveToken()
  } catch (e) {
    console.error('start-review-session: token mint failed', (e as Error).message)
    await admin.from('review_sessions').update({ status: 'abandoned', ended_at: nowIso }).eq('id', session.id)
    return json({ error: 'Failed to mint live token', detail: (e as Error).message }, 502)
  }

  return json({ sessionId: session.id, token, model, manifest })
})
