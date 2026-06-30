-- ============================================================
--  Allow authenticated learners to read public course content.
--  Affected tables: courses, concepts
--  Owners retain full access via existing policies.
-- ============================================================

-- authenticated users can browse published courses in the iOS app
create policy "authenticated users read public courses"
  on public.courses
  for select
  to authenticated
  using (
    deleted_at is null
    and visibility = 'public'
  );

-- lesson rows for public courses are readable by authenticated users
create policy "authenticated users read concepts for public courses"
  on public.concepts
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.courses c
      where c.id = concepts.course_id
        and c.deleted_at is null
        and c.visibility = 'public'
    )
  );
