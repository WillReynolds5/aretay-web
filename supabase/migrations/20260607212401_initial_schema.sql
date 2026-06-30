-- ============================================================
--  Initial schema for Aretay
--    - courses
--    - concepts
--    - reusable updated_at trigger
--    - row-level security: owners only
-- ============================================================


-- ------------------------------------------------------------
--  Reusable trigger function: bump updated_at on every UPDATE
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
--  courses
-- ============================================================
create table courses (
  id              uuid        primary key default gen_random_uuid(),
  owner_id        uuid        not null references auth.users(id) on delete cascade,

  title           text        not null,
  description     text,
  cover_image_url text,

  visibility      text        not null default 'private'
                              check (visibility in ('private', 'unlisted', 'public')),

  metadata        jsonb       not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index courses_owner_idx on courses(owner_id) where deleted_at is null;

create trigger courses_set_updated_at
  before update on courses
  for each row execute function set_updated_at();

alter table courses enable row level security;

create policy "owners read courses"
  on courses for select using (owner_id = auth.uid());

create policy "owners write courses"
  on courses for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());


-- ============================================================
--  concepts
-- ============================================================
create table concepts (
  id          uuid        primary key default gen_random_uuid(),
  course_id   uuid        not null references courses(id) on delete cascade,

  metadata    jsonb       not null default '{}'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index concepts_course_idx on concepts(course_id) where deleted_at is null;

create trigger concepts_set_updated_at
  before update on concepts
  for each row execute function set_updated_at();

alter table concepts enable row level security;

create policy "owners read concepts"
  on concepts for select using (
    exists (
      select 1 from courses c
      where c.id = concepts.course_id and c.owner_id = auth.uid()
    )
  );

create policy "owners write concepts"
  on concepts for all
  using (
    exists (
      select 1 from courses c
      where c.id = concepts.course_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from courses c
      where c.id = concepts.course_id and c.owner_id = auth.uid()
    )
  );
