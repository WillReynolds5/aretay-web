alter table courses
  add column if not exists curriculum jsonb;
