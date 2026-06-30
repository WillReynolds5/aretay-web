-- Purge multiple-choice review (RFC 001 follow-up).
--
-- The live voice agent is now the SINGLE grading path for spaced repetition —
-- it conducts both first reviews ('new' cards) and subsequent reviews. The old
-- multiple-choice tap path is fully removed from the app, so its data-model
-- residue is dropped here:
--   1. review_logs.chosen_answer    — the MC tapped option; meaningless for voice.
--   2. review_logs.source           — collapsed to voice-only.
--   3. review_sessions.mode         — every session is a voice session now.
--   4. card_states.scheduler default — new rows default to 'fsrs5' (was the
--      binary MC stamp 'fsrs5-binary'). Existing rows keep their historical stamp.

-- ── 1. review_logs: drop the MC answer column ─────────────────────────────
alter table public.review_logs drop column if exists chosen_answer;

-- ── 2. review_logs.source: collapse to voice-only ─────────────────────────
update public.review_logs set source = 'voice' where source <> 'voice';

alter table public.review_logs drop constraint if exists review_logs_source_check;
alter table public.review_logs alter column source set default 'voice';
alter table public.review_logs
  add constraint review_logs_source_check check (source = 'voice');

comment on column public.review_logs.source is
  'How the grade was produced. Always ''voice'' — the live agent is the only grading path.';

-- ── 3. review_sessions: drop the mode column (always voice) ────────────────
alter table public.review_sessions drop column if exists mode;

-- ── 4. card_states.scheduler: default new rows to the voice stamp ──────────
alter table public.card_states alter column scheduler set default 'fsrs5';
