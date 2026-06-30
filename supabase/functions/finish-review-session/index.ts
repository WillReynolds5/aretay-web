// finish-review-session edge function (RFC 001 §7.5).
//
// Closes out a review session: validates it belongs to the caller, stamps
// status + ended_at, and stores the agent's qualitative end-of-session report.
// Incremental grades are already persisted via submit-grade, so this is purely
// the wrap-up — losing it never loses a grade.
//
// Request:  { sessionId, report?, status? ('completed' | 'abandoned') }
// Response: { ok: true }

import { authenticate, guardMethod, json } from '../_shared/lib.ts'

type Body = {
  sessionId?: string
  report?: unknown
  status?: string
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

  if (!body.sessionId) return json({ error: 'sessionId required' }, 400)
  const status = body.status ?? 'completed'
  if (status !== 'completed' && status !== 'abandoned') {
    return json({ error: "status must be 'completed' or 'abandoned'" }, 400)
  }

  const { data: session, error: sessionError } = await admin
    .from('review_sessions')
    .select('id')
    .eq('id', body.sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (sessionError) return json({ error: 'Failed to load session', detail: sessionError.message }, 500)
  if (!session) return json({ error: 'Session not found for caller' }, 403)

  const { error: updateError } = await admin
    .from('review_sessions')
    .update({
      status,
      ended_at: new Date().toISOString(),
      report: body.report ?? null,
    })
    .eq('id', session.id)

  if (updateError) return json({ error: 'Failed to finish session', detail: updateError.message }, 500)

  return json({ ok: true })
})
