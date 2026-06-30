-- ============================================================
--  Remove anonymous read access to public courses.
--  Affected table: courses
--
--  Rationale: the iOS app now gates all content behind Sign in
--  with Apple and sends an authenticated bearer token on every
--  request. The earlier anon read policy (added for debug /
--  preview) let any client read public courses using only the
--  public anon key, which is embedded in the shipped app binary.
--  Dropping it restores true login gating. Authenticated read
--  access is preserved by the existing
--  "authenticated users read public courses" policy.
-- ============================================================

-- destructive: removes the anon-role select policy on courses.
-- after this runs, unauthenticated (anon) requests can no longer
-- read any rows from public.courses.
drop policy if exists "anon users read public courses" on public.courses;
