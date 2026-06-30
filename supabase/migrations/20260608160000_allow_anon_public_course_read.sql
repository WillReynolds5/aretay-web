-- ============================================================
--  Allow anon clients to read public courses (debug / preview).
--  Affected table: courses
--  Authenticated public read policy remains unchanged.
-- ============================================================

create policy "anon users read public courses"
  on public.courses
  for select
  to anon
  using (
    deleted_at is null
    and visibility = 'public'
  );
