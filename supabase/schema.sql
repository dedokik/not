-- Supabase schema для Not (выполнить в SQL Editor, когда заведёшь проект)
-- Покрывает полный план: заметки, измерения, связи, чанки, пиксели карты.

create table if not exists dimensions (
  id text primary key,
  name text not null,
  color text not null default '#d1d5db'
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  body text not null default '',
  dimension text not null default 'study' references dimensions(id),
  estimate_hours numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- ручные связи между заметками (авто-связи через [[Название]] парсятся локально)
create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references notes(id) on delete cascade,
  to_id uuid not null references notes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_id, to_id)
);

-- ежедневные чанки auto-chunking + привычки (habit = чекбокс на каждый день)
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  day date not null,
  hours numeric not null default 0,
  done boolean not null default false,
  habit boolean not null default false,
  unique (note_id, day, habit)
);
-- миграция для баз, созданных до появления habit:
alter table chunks drop constraint if exists chunks_note_id_day_key;
alter table chunks add column if not exists habit boolean not null default false;
alter table chunks drop constraint if exists chunks_note_day_habit_key;
alter table chunks add constraint chunks_note_day_habit_key unique (note_id, day, habit);

create table if not exists pixels (
  x int not null,
  y int not null,
  note_id uuid references notes(id) on delete set null,
  opened_at timestamptz not null default now(),
  primary key (x, y)
);

-- события календаря: день + подпись, отдельно от заметок.
-- id текстовый и стабильный на всех устройствах (ev...), deleted = soft-delete:
-- удаление расходится синком и никогда не воскресает.
create table if not exists events (
  id text primary key,
  day date not null,
  title text not null default '',
  dimension text references dimensions(id) on delete set null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into dimensions (id, name, color) values
  ('study', 'Учёба', '#8b5cf6'),
  ('personal', 'Личное', '#10b981'),
  ('projects', 'Проекты', '#f59e0b')
on conflict (id) do nothing;

alter table notes enable row level security;
alter table pixels enable row level security;
alter table dimensions enable row level security;
alter table links enable row level security;
alter table chunks enable row level security;
alter table events enable row level security;

-- Для старта (один пользователь, anon-доступ) — простые политики.
-- Позже замени на auth.uid()-политики.
-- DROPы нужны, чтобы скрипт можно было запускать повторно.
drop policy if exists "allow all" on notes;
drop policy if exists "allow all" on pixels;
drop policy if exists "allow all" on dimensions;
drop policy if exists "allow all" on links;
drop policy if exists "allow all" on chunks;
drop policy if exists "allow all" on events;
create policy "allow all" on notes for all using (true) with check (true);
create policy "allow all" on pixels for all using (true) with check (true);
create policy "allow all" on dimensions for all using (true) with check (true);
create policy "allow all" on links for all using (true) with check (true);
create policy "allow all" on chunks for all using (true) with check (true);
create policy "allow all" on events for all using (true) with check (true);
