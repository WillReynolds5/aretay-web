// submit-grade edge function (RFC 001 §6.5, §7.6).
//
// The single trust boundary for voice grades. The device runs FSRS locally and
// posts the resulting state here; this function VALIDATES that the graded card
// is owned by the caller, that the rating and assessment are in range, and that
// the session belongs to the caller — then writes the append-only review_logs
// row and upserts card_states. The before-state is read from the DB
// (authoritative), not trusted from the client.
//
// Request: {
//   sessionId, cardId,
//   rating: 1..4, assessment: 'correct'|'partial'|'incorrect'|'skipped',
//   answerTranscript?, agentRationale?, durationMs?,
//   // device-computed FSRS outcome:
//   state, stability, difficulty, due (ISO), elapsedDays, reps, lapses,
//   scheduler? (default 'fsrs5')
// }
// Response: { ok: true, cardStateId }

import { authenticate, guardMethod, json } from '../_shared/lib.ts'

const ASSESSMENTS = new Set(['correct', 'partial', 'incorrect', 'skipped'])
const STATES = new Set(['new', 'learning', 'review', 'relearning'])

type Body = {
  sessionId?: string
  cardId?: string
  rating?: number
  assessment?: string
  answerTranscript?: string | null
  agentRationale?: string | null
  durationMs?: number | null
  state?: string
  stability?: number
  difficulty?: number
  due?: string
  elapsedDays?: number
  reps?: number
  lapses?: number
  scheduler?: string
}

Deno.serve(async (req: Request) => {
  const guard = guardMethod(req)
  if (guard) return guard

  const ctx = await authenticate(req)
  if (ctx instanceof Response) return ctx
  const { userId, admin } = ctx

  let body: Body
  try {
    body = await req.json()
  } catch (e) {
    return json({ error: 'Invalid request body', detail: (e as Error).message }, 400)
  }

  const { sessionId, cardId } = body

  // ── validate the grade shape ────────────────────────────────────────────
  if (!cardId) return json({ error: 'cardId required' }, 400)
  if (!sessionId) return json({ error: 'sessionId required' }, 400)
  if (![1, 2, 3, 4].includes(body.rating as number)) {
    return json({ error: 'rating must be 1, 2, 3, or 4' }, 400)
  }
  if (!ASSESSMENTS.has(body.assessment as string)) {
    return json({ error: 'assessment out of range' }, 400)
  }
  if (!STATES.has(body.state as string)) {
    return json({ error: 'state out of range' }, 400)
  }
  if (typeof body.stability !== 'number' || typeof body.difficulty !== 'number' || !body.due) {
    return json({ error: 'FSRS outcome (stability, difficulty, due) required' }, 400)
  }

  // ── validate the session belongs to the caller and is active ─────────────
  const { data: session, error: sessionError } = await admin
    .from('review_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (sessionError) return json({ error: 'Failed to load session', detail: sessionError.message }, 500)
  if (!session) return json({ error: 'Session not found for caller' }, 403)
  if (session.status !== 'active') return json({ error: 'Session is not active' }, 409)

  // ── validate the card is owned by the caller ─────────────────────────────
  // The card_state row (scoped to user_id) is the ownership proof: it only
  // exists once the parent segment has been studied. 'new' cards are valid here
  // — the voice agent conducts their first review (there is no MC path).
  const { data: cardState, error: cardStateError } = await admin
    .from('card_states')
    .select('id, state, stability, difficulty, reps, lapses')
    .eq('user_id', userId)
    .eq('card_id', cardId)
    .maybeSingle()

  if (cardStateError) return json({ error: 'Failed to load card state', detail: cardStateError.message }, 500)
  if (!cardState) return json({ error: 'Card is not tracked for this user' }, 403)

  const scheduler = body.scheduler ?? 'fsrs5'
  const nowIso = new Date().toISOString()

  // ── write the append-only log (before-state from the DB row) ─────────────
  const { data: log, error: logError } = await admin
    .from('review_logs')
    .insert({
      card_state_id: cardState.id,
      user_id: userId,
      session_id: sessionId,
      source: 'voice',
      rating: body.rating,
      assessment: body.assessment,
      answer_transcript: body.answerTranscript ?? null,
      agent_rationale: body.agentRationale ?? null,
      state_before: cardState.state,
      stability_before: cardState.stability,
      difficulty_before: cardState.difficulty,
      elapsed_days: body.elapsedDays ?? null,
      stability_after: body.stability,
      difficulty_after: body.difficulty,
      due_after: body.due,
      duration_ms: body.durationMs ?? null,
    })
    .select('id')
    .single()

  if (logError || !log) {
    return json({ error: 'Failed to write review log', detail: logError?.message }, 500)
  }

  // ── advance card_states with the device-computed FSRS outcome ────────────
  const { error: updateError } = await admin
    .from('card_states')
    .update({
      state: body.state,
      stability: body.stability,
      difficulty: body.difficulty,
      due: body.due,
      reps: body.reps ?? cardState.reps + 1,
      lapses: body.lapses ?? cardState.lapses,
      last_reviewed_at: nowIso,
      scheduler,
    })
    .eq('id', cardState.id)

  if (updateError) {
    return json({ error: 'Failed to update card state', detail: updateError.message }, 500)
  }

  return json({ ok: true, cardStateId: cardState.id })
})
