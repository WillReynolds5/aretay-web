-- Rename concepts → cards.
--
-- The table holds one row per renderable unit — intro/segment videos and
-- spaced-repetition question clips. "Cards" matches FSRS terminology now that
-- the mobile app schedules reviews against these rows.

alter table public.concepts rename to cards;

-- Constraints
alter table public.cards rename constraint concepts_pkey to cards_pkey;
alter table public.cards rename constraint concepts_course_id_fkey to cards_course_id_fkey;

-- Indexes
alter index public.concepts_course_idx rename to cards_course_idx;
alter index public.concepts_course_segment_uidx rename to cards_course_segment_uidx;

-- Trigger
alter trigger concepts_set_updated_at on public.cards rename to cards_set_updated_at;

-- Policies (expressions are stored by OID, so they already point at cards)
alter policy "owners read concepts" on public.cards rename to "owners read cards";
alter policy "owners write concepts" on public.cards rename to "owners write cards";
alter policy "authenticated users read concepts for public courses" on public.cards
  rename to "authenticated users read cards for public courses";

comment on table public.cards is
  'One row per renderable unit of a course: the intro, each lesson segment, and each spaced-repetition question (segment_key: intro, L1-S1, L1-S1-Q1, …). Question rows are the FSRS cards the app reviews.';
