-- ============================================================
--  Move lesson production data off courses.curriculum.
--  Affected table: concepts
--  Adds video_r2_key, backfills from curriculum json, strips
--  captions/video_r2_key from curriculum.videos entries.
-- ============================================================

alter table public.concepts
  add column if not exists video_r2_key text;

comment on table public.concepts is 'One row per curriculum lesson; stores generated video and captions.';
comment on column public.concepts.lesson_id is 'Matches curriculum.videos[].id for this course.';
comment on column public.concepts.video_r2_key is 'R2 object key for the generated lesson video.';
comment on column public.concepts.captions is 'Word-level caption tokens from Whisper (Remotion Caption format).';

-- backfill concept rows from existing curriculum videos
insert into public.concepts (course_id, lesson_id, captions, video_r2_key, metadata)
select
  courses.id,
  (video.value->>'id')::integer,
  video.value->'captions',
  nullif(video.value->>'video_r2_key', ''),
  '{}'::jsonb
from public.courses
cross join lateral jsonb_array_elements(courses.curriculum->'videos') as video(value)
where
  courses.deleted_at is null
  and courses.curriculum is not null
  and video.value->>'id' is not null
on conflict (course_id, lesson_id) where ((deleted_at is null) and (lesson_id is not null))
do update set
  captions = coalesce(public.concepts.captions, excluded.captions),
  video_r2_key = coalesce(public.concepts.video_r2_key, excluded.video_r2_key);

-- remove production fields from curriculum; keep prompt output only
update public.courses
set curriculum = jsonb_set(
  curriculum,
  '{videos}',
  coalesce(
    (
      select jsonb_agg(
        (video - 'captions' - 'video_r2_key')
        order by (video->>'id')::integer
      )
      from jsonb_array_elements(curriculum->'videos') as video
    ),
    '[]'::jsonb
  )
)
where
  deleted_at is null
  and curriculum is not null
  and curriculum ? 'videos';
