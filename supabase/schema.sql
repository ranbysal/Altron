-- Altron desk: accounts, orders, fills, trades and the trade notes members read.
-- Run once in the Supabase SQL editor of a new project. Safe to re-run.

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'trader', 'owner')),
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- every new sign-up starts as a member; promote the trader by hand (see README)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_trader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('trader', 'owner'));
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- the one account the desk trades (the copier fans it out elsewhere)
-- ---------------------------------------------------------------------------

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  broker text not null default 'paper',
  starting_balance numeric(14, 2) not null default 100000,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- the book
-- ---------------------------------------------------------------------------

create table if not exists public.orders (
  id text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  sym text not null check (sym in ('NQ', 'ES', 'MNQ', 'MES')),
  side smallint not null check (side in (1, -1)),
  qty integer not null check (qty > 0),
  type text not null check (type in ('MKT', 'LMT', 'STP', 'STPLMT', 'TRAIL')),
  role text not null check (role in ('entry', 'stop', 'target', 'exit')),
  limit_price numeric(12, 2),
  stop_price numeric(12, 2),
  trail numeric(12, 2),
  oco text,
  reduce_only boolean not null default false,
  status text not null default 'working' check (status in ('working', 'filled', 'cancelled')),
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_account_status on public.orders (account_id, status);

create table if not exists public.trades (
  id text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  sym text not null check (sym in ('NQ', 'ES', 'MNQ', 'MES')),
  side text not null check (side in ('LONG', 'SHORT')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  qty integer not null,
  entry_qty integer not null,
  entry_value numeric(16, 2) not null,
  exit_qty integer not null default 0,
  exit_value numeric(16, 2) not null default 0,
  pnl numeric(14, 2) not null default 0,
  risk numeric(14, 2)
);
create index if not exists trades_account_opened on public.trades (account_id, opened_at desc);

create table if not exists public.fills (
  id text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  order_id text not null,
  trade_id text references public.trades (id) on delete set null,
  sym text not null check (sym in ('NQ', 'ES', 'MNQ', 'MES')),
  side smallint not null check (side in (1, -1)),
  qty integer not null check (qty > 0),
  price numeric(12, 2) not null,
  role text not null check (role in ('entry', 'stop', 'target', 'exit')),
  realized numeric(14, 2) not null default 0,
  at timestamptz not null
);
create index if not exists fills_trade on public.fills (trade_id, at);

-- ---------------------------------------------------------------------------
-- notes: a small chat members follow live. Edits never overwrite; the text
-- being replaced is kept, with the time it was replaced.
-- ---------------------------------------------------------------------------

create table if not exists public.trade_notes (
  id text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  trade_id text references public.trades (id) on delete set null, -- null until the trade it was written for opens
  sym text not null check (sym in ('NQ', 'ES', 'MNQ', 'MES')),
  phase text not null check (phase in ('before', 'during', 'after')),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists notes_trade on public.trade_notes (trade_id, created_at);

create table if not exists public.trade_note_edits (
  id bigint generated always as identity primary key,
  note_id text not null references public.trade_notes (id) on delete cascade,
  body text not null,
  replaced_at timestamptz not null default now()
);
create index if not exists note_edits_note on public.trade_note_edits (note_id, replaced_at);

create or replace function public.keep_note_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := old.created_at; -- the time a note was sent never changes
  if new.body is distinct from old.body then
    insert into public.trade_note_edits (note_id, body, replaced_at) values (old.id, old.body, now());
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trade_notes_history on public.trade_notes;
create trigger trade_notes_history
  before update on public.trade_notes
  for each row execute function public.keep_note_history();

-- ---------------------------------------------------------------------------
-- notices: what members are sent. Entries, working orders, fills, moved stops
-- and targets, and exits, each with the moment it went out, to the second.
-- Never edited or deleted: this is the record of what members were told.
-- ---------------------------------------------------------------------------

create table if not exists public.notices (
  id text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  trade_id text references public.trades (id) on delete set null,
  kind text not null check (kind in ('entry', 'order', 'fill', 'stop', 'target', 'exit')),
  sym text not null check (sym in ('NQ', 'ES', 'MNQ', 'MES')),
  side smallint check (side in (-1, 1)),
  qty integer check (qty > 0),
  price numeric(12, 2),
  order_type text check (order_type in ('MKT', 'LMT', 'STP', 'STPLMT', 'TRAIL')),
  stop numeric(12, 2),
  target numeric(12, 2),
  was numeric(12, 2), -- a moved stop or target: what members were told before
  pnl numeric(14, 2),
  why text,
  note text check (note is null or length(note) between 1 and 600),
  sent_at timestamptz not null default now()
);
create index if not exists notices_sent on public.notices (sent_at desc);
create index if not exists notices_trade on public.notices (trade_id, sent_at);

-- ---------------------------------------------------------------------------
-- desk settings (sizes, brackets, panels), one row per account
-- ---------------------------------------------------------------------------

create table if not exists public.desk_settings (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- who can do what: the trader writes; members read the trades, fills and notes
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.orders enable row level security;
alter table public.trades enable row level security;
alter table public.fills enable row level security;
alter table public.trade_notes enable row level security;
alter table public.trade_note_edits enable row level security;
alter table public.desk_settings enable row level security;

drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select using (public.is_member());
drop policy if exists "profiles: edit own" on public.profiles;
create policy "profiles: edit own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- people can change their name and picture, not their role; roles are set from the SQL editor
create or replace function public.lock_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Roles are changed by the owner from the SQL editor';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_lock_role on public.profiles;
create trigger profiles_lock_role
  before update on public.profiles
  for each row execute function public.lock_role();

drop policy if exists "accounts: read" on public.accounts;
create policy "accounts: read" on public.accounts for select using (public.is_member());
drop policy if exists "accounts: trader writes" on public.accounts;
create policy "accounts: trader writes" on public.accounts for all using (public.is_trader() and owner = auth.uid()) with check (public.is_trader() and owner = auth.uid());

-- working orders stay with the trader
drop policy if exists "orders: trader only" on public.orders;
create policy "orders: trader only" on public.orders for all using (public.is_trader()) with check (public.is_trader());

drop policy if exists "trades: members read" on public.trades;
create policy "trades: members read" on public.trades for select using (public.is_member());
drop policy if exists "trades: trader writes" on public.trades;
create policy "trades: trader writes" on public.trades for insert with check (public.is_trader());
drop policy if exists "trades: trader updates" on public.trades;
create policy "trades: trader updates" on public.trades for update using (public.is_trader()) with check (public.is_trader());

drop policy if exists "fills: members read" on public.fills;
create policy "fills: members read" on public.fills for select using (public.is_member());
drop policy if exists "fills: trader writes" on public.fills;
create policy "fills: trader writes" on public.fills for insert with check (public.is_trader());

-- notes can be written and edited, never deleted, so the record members saw stays
drop policy if exists "notes: members read" on public.trade_notes;
create policy "notes: members read" on public.trade_notes for select using (public.is_member());
drop policy if exists "notes: trader writes" on public.trade_notes;
create policy "notes: trader writes" on public.trade_notes for insert with check (public.is_trader());
drop policy if exists "notes: trader edits" on public.trade_notes;
create policy "notes: trader edits" on public.trade_notes for update using (public.is_trader()) with check (public.is_trader());

drop policy if exists "note edits: members read" on public.trade_note_edits;
create policy "note edits: members read" on public.trade_note_edits for select using (public.is_member());
-- rows here are written only by the history trigger

alter table public.notices enable row level security;
drop policy if exists "notices: members read" on public.notices;
create policy "notices: members read" on public.notices for select using (public.is_member());
drop policy if exists "notices: trader sends" on public.notices;
create policy "notices: trader sends" on public.notices for insert with check (public.is_trader());
-- no update or delete policy: a notice stays as it was sent

drop policy if exists "settings: trader only" on public.desk_settings;
create policy "settings: trader only" on public.desk_settings for all using (public.is_trader()) with check (public.is_trader());

-- ---------------------------------------------------------------------------
-- live: members' screens update as trades, fills and notes land
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['trades', 'fills', 'trade_notes', 'trade_note_edits', 'notices'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
