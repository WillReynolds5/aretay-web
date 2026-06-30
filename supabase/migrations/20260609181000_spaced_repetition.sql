-- Spaced repetition: enrollments, per-user FSRS card state, and review logs.
--
-- The app uses a simplified binary FSRS: right → Good (3), wrong → Again (1).
-- The scheduler runs client-side (Swift); these tables persist its state.
-- review_logs is append-only so card state can be replayed or per-user FSRS
-- weights fitted server-side later without a schema change.

-- ── 1. course_enrollments ────────────────────────────────────────────────
-- One row per (user, course). Content progression is strictly linear
-- (intro → L1-S1 → its questions → L1-S2 → …), so a single cursor encodes
-- which segments have been watched.

create table public.course_enrollments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,

  -- last segment whose video was completed ('intro', 'L1-S1', …); null = not started
  cursor_segment_key text,
  segments_completed integer not null default 0,

  -- per-user scheduling knobs
  desired_retention        real     not null default 0.90
                           check (desired_retention > 0.5 and desired_retention < 0.995),
  new_segments_per_session smallint not null default 2
                           check (new_segments_per_session between 1 and 10),

  started_at      timestamptz not null default now(),
  last_studied_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (user_id, course_id)
);

create index course_enrollments_user_idx on public.course_enrollments(user_id);

create trigger course_enrollments_set_updated_at
  before update on public.course_enrollments
  for each row execute function set_updated_at();

alter table public.course_enrollments enable row level security;

create policy "users manage own enrollments"
  on public.course_enrollments for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 2. card_states ───────────────────────────────────────────────────────
-- FSRS memory state, one row per (user, question card). Created lazily the
-- first time the parent segment's video is completed.

create table public.card_states (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  card_id    uuid not null references public.cards(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade, -- denormalized for the due query

  state      text not null default 'new'
             check (state in ('new', 'learning', 'review', 'relearning')),
  due        timestamptz not null default now(),
  stability  double precision,  -- null until first review
  difficulty double precision,  -- null until first review
  reps       integer not null default 0,
  lapses     integer not null default 0,
  last_reviewed_at timestamptz,

  -- algorithm/version stamp so a future scheduler can migrate state cleanly
  scheduler  text not null default 'fsrs5-binary',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, card_id)
);

-- the hot query: "what's due for me in this course right now"
create index card_states_due_idx
  on public.card_states (user_id, course_id, due)
  where state <> 'new';

create trigger card_states_set_updated_at
  before update on public.card_states
  for each row execute function set_updated_at();

alter table public.card_states enable row level security;

create policy "users manage own card states"
  on public.card_states for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 3. review_logs ───────────────────────────────────────────────────────
-- Append-only answer history. Powers streak/XP/retention stats and future
-- per-user FSRS parameter fitting. Never updated or deleted by the app.

create table public.review_logs (
  id            bigint generated always as identity primary key,
  card_state_id uuid not null references public.card_states(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  rating        smallint not null check (rating in (1, 3)), -- 1 = wrong (Again), 3 = right (Good)
  chosen_answer text,

  state_before      text not null,
  stability_before  double precision,
  difficulty_before double precision,
  elapsed_days      real,            -- days since previous review; 0 for first
  stability_after   double precision not null,
  difficulty_after  double precision not null,
  due_after         timestamptz not null,

  duration_ms   integer,             -- time from options shown to answer tapped
  reviewed_at   timestamptz not null default now()
);

create index review_logs_user_time_idx on public.review_logs (user_id, reviewed_at desc);
create index review_logs_card_state_idx on public.review_logs (card_state_id, reviewed_at);

alter table public.review_logs enable row level security;

create policy "users read own review logs"
  on public.review_logs for select
  to authenticated
  using (user_id = auth.uid());

create policy "users insert own review logs"
  on public.review_logs for insert
  to authenticated
  with check (user_id = auth.uid());
