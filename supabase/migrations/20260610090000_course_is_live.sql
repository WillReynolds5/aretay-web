-- ────────────────────────────────────────────────────────────────
--  Add an is_live publishing flag to courses.
--  Affected table: courses
--
--  Visibility controls who *may* read a course (RLS); is_live is an
--  editorial switch toggled from the admin console that controls
--  whether the iOS app *lists* it. Courses stay hidden from the app
--  until explicitly flipped live, so half-produced courses don't
--  show up in the catalog.
-- ────────────────────────────────────────────────────────────────

alter table public.courses
  add column is_live boolean not null default false;
