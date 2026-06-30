-- ============================================================
--  Link concepts to curriculum lessons and store caption data.
--  Affected table: concepts
--  Adds lesson_id (curriculum video id) and captions (whisper/remotion format).
-- ============================================================

alter table concepts
  add column if not exists lesson_id integer,
  add column if not exists captions jsonb;

comment on column concepts.lesson_id is 'Matches curriculum.videos[].id for this course.';
comment on column concepts.captions is 'Word-level caption tokens from Whisper (Remotion Caption format).';

-- one concept row per lesson within a course
create unique index if not exists concepts_course_lesson_uidx
  on concepts (course_id, lesson_id)
  where deleted_at is null and lesson_id is not null;
