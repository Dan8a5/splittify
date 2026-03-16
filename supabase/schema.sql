-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (mirrors auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null unique,
  created_at timestamptz default now() not null
);

-- Groups
create table if not exists groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_by uuid references profiles(id) on delete set null,
  archived boolean default false not null,
  created_at timestamptz default now() not null
);

-- Group members
create table if not exists group_members (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  joined_at timestamptz default now() not null,
  unique (group_id, user_id)
);

-- Expenses (amounts stored in integer cents)
create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups(id) on delete cascade not null,
  paid_by uuid references profiles(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  description text not null,
  created_at timestamptz default now() not null
);

-- Expense splits
create table if not exists expense_splits (
  id uuid default gen_random_uuid() primary key,
  expense_id uuid references expenses(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  amount_cents integer not null check (amount_cents >= 0)
);

-- =====================
-- Row Level Security
-- =====================

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;

-- Profiles: authenticated users can read all (needed for invite by email)
create policy "profiles_select" on profiles for select to authenticated using (true);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- Helper function to get current user's group IDs without RLS recursion
create or replace function public.get_my_group_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select group_id from public.group_members where user_id = auth.uid()
$$;

-- Auto-create profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Groups: only members can read
create policy "groups_select" on groups for select using (
  id in (select public.get_my_group_ids())
);
create policy "groups_insert" on groups for insert with check (auth.uid() = created_by);
create policy "groups_update" on groups for update using (
  id in (select public.get_my_group_ids())
);

-- Group members: members can read; can add self or add others if already a member
create policy "group_members_select" on group_members for select using (
  group_id in (select public.get_my_group_ids())
);
create policy "group_members_insert" on group_members for insert with check (
  user_id = auth.uid()
  or group_id in (select public.get_my_group_ids())
);

-- Expenses: group members can read/write
create policy "expenses_select" on expenses for select using (
  group_id in (select public.get_my_group_ids())
);
create policy "expenses_insert" on expenses for insert with check (
  group_id in (select public.get_my_group_ids())
);

-- Expense splits
create policy "expense_splits_select" on expense_splits for select using (
  exists (
    select 1 from public.expenses e
    where e.id = expense_splits.expense_id
    and e.group_id in (select public.get_my_group_ids())
  )
);
create policy "expense_splits_insert" on expense_splits for insert with check (
  exists (
    select 1 from public.expenses e
    where e.id = expense_splits.expense_id
    and e.group_id in (select public.get_my_group_ids())
  )
);

-- Settlements (records that one member paid another to settle a debt)
create table if not exists settlements (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups(id) on delete cascade not null,
  from_user_id uuid references profiles(id) on delete cascade not null,
  to_user_id uuid references profiles(id) on delete cascade not null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz default now() not null
);

alter table settlements enable row level security;

create policy "settlements_select" on settlements for select using (
  group_id in (select public.get_my_group_ids())
);

create policy "settlements_insert" on settlements for insert with check (
  group_id in (select public.get_my_group_ids())
);

-- Messages
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references groups(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  body text not null check (char_length(body) > 0 and char_length(body) <= 1000),
  created_at timestamptz default now() not null
);

alter table messages enable row level security;

-- Only group members can read messages in their groups
create policy "messages_select" on messages for select using (
  group_id in (select public.get_my_group_ids())
);

-- Members can only post as themselves
create policy "messages_insert" on messages for insert with check (
  user_id = auth.uid()
  and group_id in (select public.get_my_group_ids())
);
