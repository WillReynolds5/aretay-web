-- Live Voice Review Agent (RFC 001).
--
-- Moves spaced-repetition review from a synchronous binary multiple-choice tap
-- to a deferred, flexible LLM grade produced by a live voice agent. Three things
-- change in the data model:
--   1. Sessions become a persisted entity (review_sessions) so the agent's
--      end-of-session report has an owner.
--   2. review_logs gains voice-grading context (session, source, transcript,
--      semantic assessment, rationale).
--   3. The binary rating check (1,3) widens to the full FSRS Again/Hard/Good/Easy
--      scale (1,2,3,4) — voice sessions stamp card_states.scheduler = 'fsrs5'.
-- Existing binary history (rating 1/3, scheduler 'fsrs5-binary') stays valid;
-- card state replays from review_logs under a scheduler version, so no backfill.

-- ── 1. review_sessions ───────────────────────────────────────────────────
-- Owner of the agent's end-of-session report (RFC §7.2). Created by the
-- start-review-session Edge Function and finalized by finish-review-session.

create table public.review_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid references public.courses(id) on delete set null,  -- null = cross-course feed

  mode       text not null default 'voice' check (mode in ('voice', 'mc')),
  scheduler  text not null,                                          -- fsrs version stamp used
  status     text not null default 'active'
             check (status in ('active', 'completed', 'abandoned')),

  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  card_count int not null default 0,

  -- { overall, strengths[], weaknesses[], focus_next[] } — qualitative wrap-up
  report     jsonb,

  created_at timestamptz not null default now()
);

create index review_sessions_user_idx
  on public.review_sessions (user_id, started_at desc);

alter table public.review_sessions enable row level security;

create policy "users manage own review sessions"
  on public.review_sessions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.review_sessions is
  'One row per spaced-repetition review session. Owns the live voice agent''s end-of-session report (review_sessions.report).';

-- ── 2. review_logs — extend for voice grading (RFC §7.3) ───────────────────
-- The append-only history that card state replays from is the right home for
-- per-card grades. The agent emits a semantic assessment, not a raw FSRS number;
-- rating is still stored, derived from assessment by client code (RFC §9.2).

alter table public.review_logs
  add column session_id        uuid references public.review_sessions(id) on delete set null,
  add column source            text not null default 'mc'
                               check (source in ('mc', 'voice')),
  add column answer_transcript text,
  add column assessment        text
                               check (assessment in ('correct', 'partial', 'incorrect', 'skipped')),
  add column agent_rationale   text;

create index review_logs_session_idx
  on public.review_logs (session_id)
  where session_id is not null;

comment on column public.review_logs.source is
  'How the grade was produced: mc (multiple-choice tap) or voice (live agent judgment).';
comment on column public.review_logs.assessment is
  'Semantic judgment from the voice agent (RFC §9.1); rating is derived from it.';

-- ── 3. review_logs.rating — widen binary check to the full FSRS scale ──────
-- Today: check (rating in (1, 3)) — binary FSRS-5 (1 = Again, 3 = Good).
-- fsrs5 needs Hard (2) and Easy (4). Existing rows (1/3) remain valid.

alter table public.review_logs drop constraint review_logs_rating_check;
alter table public.review_logs
  add constraint review_logs_rating_check check (rating in (1, 2, 3, 4));

comment on column public.review_logs.rating is
  'FSRS grade: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. Binary path emits only 1/3.';

-- card_states needs no schema change — scheduler is free text. Voice sessions
-- stamp the new 'fsrs5' value; the MC path keeps 'fsrs5-binary'.
