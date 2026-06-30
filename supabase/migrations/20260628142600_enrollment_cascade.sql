-- Cascade a course "un-enrollment" to its spaced-repetition data.
--
-- Deleting a course_enrollments row (a user resetting or leaving a course) should
-- wipe that user's progress for the course: their per-card FSRS state AND the
-- review history. card_states already cascades to review_logs (review_logs.
-- card_state_id … on delete cascade), so we only need card_states to follow the
-- enrollment. We hang a composite FK off the enrollment's (user_id, course_id)
-- unique key.
--
-- Delete chain after this migration:
--   delete course_enrollments(user, course)
--     → delete card_states(user, course)     (this FK)
--       → delete review_logs(card_state_id)   (existing FK)
--
-- review_sessions are intentionally left alone — they're per-session report
-- containers, not per-card data, and their course_id is already nullable.

-- 1. Backfill so the constraint validates: a composite FK can only be added if
--    every card_states row already has a matching enrollment. The app always
--    creates an enrollment alongside card states, but make this self-healing for
--    any historical drift. The defaults cover every other enrollment column.
insert into public.course_enrollments (user_id, course_id)
select distinct cs.user_id, cs.course_id
from public.card_states cs
left join public.course_enrollments ce
  on ce.user_id = cs.user_id and ce.course_id = cs.course_id
where ce.id is null
on conflict (user_id, course_id) do nothing;

-- 2. The cascade FK. (user_id, course_id) references the enrollment's unique key,
--    so removing the enrollment removes the matching card states (course deletion
--    and user deletion still cascade directly, as before — multiple delete paths
--    are fine).
alter table public.card_states
  add constraint card_states_enrollment_fkey
  foreign key (user_id, course_id)
  references public.course_enrollments (user_id, course_id)
  on delete cascade;

comment on constraint card_states_enrollment_fkey on public.card_states is
  'Deleting a course_enrollments row cascades to the user''s card_states for that course (and onward to review_logs), so leaving/resetting a course wipes its progress.';
