-- ============================================================
--  Switch concepts from lesson_id to segment_key.
--  Each concept row maps to one renderable script section
--  (intro or lesson segment) for video + caption production.
-- ============================================================

alter table public.concepts
  add column if not exists segment_key text;

comment on column public.concepts.segment_key is
  'Stable key for a renderable script: intro, L{order}-S{segment_number}.';

-- one concept row per script section within a course
create unique index if not exists concepts_course_segment_uidx
  on public.concepts (course_id, segment_key)
  where deleted_at is null and segment_key is not null;

-- drop old lesson-based index and column (experimental rebuild)
drop index if exists public.concepts_course_lesson_uidx;

alter table public.concepts
  drop column if exists lesson_id;
