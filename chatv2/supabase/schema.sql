create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 32),
  avatar_seed text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 50),
  invite_code text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (server_id, user_id)
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('text', 'voice')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  attachment_url text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint messages_body_or_attachment check (char_length(body) > 0 or attachment_url is not null)
);

create table if not exists public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dm_thread_members (
  thread_id uuid not null references public.dm_threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (thread_id, user_id)
);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.dm_threads (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  attachment_url text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint dm_messages_body_or_attachment check (char_length(body) > 0 or attachment_url is not null)
);

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
alter table public.dm_threads enable row level security;
alter table public.dm_thread_members enable row level security;
alter table public.dm_messages enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.servers to authenticated;
grant select on public.server_members to authenticated;
grant select, insert on public.channels to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.dm_threads to authenticated;
grant select on public.dm_thread_members to authenticated;
grant select, insert on public.dm_messages to authenticated;

create schema if not exists private;

create or replace function private.is_server_member(target_server_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.server_members
    where server_id = target_server_id and user_id = auth.uid()
  );
$$;

create or replace function private.is_dm_thread_member(target_thread_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.dm_thread_members
    where thread_id = target_thread_id and user_id = auth.uid()
  );
$$;

create or replace function public.generate_invite_code()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.servers where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_seed)
  values (
    new.id,
    left(lpad(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'user'), 2, '_'), 32),
    regexp_replace(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'user'), '\s+', '-', 'g')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.create_server_with_defaults(server_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  next_server_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  insert into public.servers (owner_id, name, invite_code)
  values (auth.uid(), trim(server_name), public.generate_invite_code())
  returning id into next_server_id;

  insert into public.server_members (server_id, user_id)
  values (next_server_id, auth.uid());

  insert into public.channels (server_id, name, kind)
  values
    (next_server_id, 'general', 'text'),
    (next_server_id, 'voice lounge', 'voice');

  return next_server_id;
end;
$$;

create or replace function public.join_server_by_code(invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  next_server_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  select id into next_server_id from public.servers where invite_code = upper(trim(invite));

  if next_server_id is null then
    raise exception 'Invite code not found';
  end if;

  insert into public.server_members (server_id, user_id)
  values (next_server_id, auth.uid())
  on conflict (server_id, user_id) do nothing;

  return next_server_id;
end;
$$;

create or replace function public.create_or_get_dm_thread(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_thread_id uuid;
  next_thread_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  if other_user_id = auth.uid() then
    raise exception 'Cannot DM yourself';
  end if;

  if not exists (
    select 1
    from public.server_members left_member
    join public.server_members right_member
      on left_member.server_id = right_member.server_id
    where left_member.user_id = auth.uid() and right_member.user_id = other_user_id
  ) then
    raise exception 'You can only DM someone who shares a server with you';
  end if;

  select left_member.thread_id
    into existing_thread_id
  from public.dm_thread_members left_member
  join public.dm_thread_members right_member
    on left_member.thread_id = right_member.thread_id
  where left_member.user_id = auth.uid()
    and right_member.user_id = other_user_id
  limit 1;

  if existing_thread_id is not null then
    return existing_thread_id;
  end if;

  insert into public.dm_threads default values returning id into next_thread_id;

  insert into public.dm_thread_members (thread_id, user_id)
  values
    (next_thread_id, auth.uid()),
    (next_thread_id, other_user_id);

  return next_thread_id;
end;
$$;

grant execute on function public.create_server_with_defaults(text) to authenticated;
grant execute on function public.join_server_by_code(text) to authenticated;
grant execute on function public.create_or_get_dm_thread(uuid) to authenticated;

create policy "profiles are visible to authenticated users"
on public.profiles for select
to authenticated
using (true);

create policy "users can insert their own profile"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

create policy "users can update their own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "members can view their servers"
on public.servers for select
to authenticated
using (
  exists (
    select 1 from public.server_members
    where server_members.server_id = servers.id and server_members.user_id = auth.uid()
  )
);

create policy "authenticated users can create servers"
on public.servers for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "owners can update servers"
on public.servers for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "members can view memberships"
on public.server_members for select
to authenticated
using (
  private.is_server_member(server_members.server_id)
);

create policy "owners can manage memberships"
on public.server_members for insert
to authenticated
with check (
  exists (
    select 1 from public.servers
    where servers.id = server_members.server_id and servers.owner_id = auth.uid()
  )
);

create policy "members can view channels"
on public.channels for select
to authenticated
using (
  private.is_server_member(channels.server_id)
);

create policy "owners can create channels"
on public.channels for insert
to authenticated
with check (
  exists (
    select 1 from public.servers
    where servers.id = channels.server_id and servers.owner_id = auth.uid()
  )
);

create policy "members can view channel messages"
on public.messages for select
to authenticated
using (
  exists (
    select 1
    from public.channels
    where channels.id = messages.channel_id and private.is_server_member(channels.server_id)
  )
);

create policy "members can send channel messages"
on public.messages for insert
to authenticated
with check (
  auth.uid() = author_id
  and exists (
    select 1
    from public.channels
    where channels.id = messages.channel_id and private.is_server_member(channels.server_id)
  )
);

create policy "dm members can view threads"
on public.dm_threads for select
to authenticated
using (
  private.is_dm_thread_member(dm_threads.id)
);

create policy "dm members can view thread memberships"
on public.dm_thread_members for select
to authenticated
using (
  private.is_dm_thread_member(dm_thread_members.thread_id)
);

create policy "dm members can view messages"
on public.dm_messages for select
to authenticated
using (
  private.is_dm_thread_member(dm_messages.thread_id)
);

create policy "dm members can send messages"
on public.dm_messages for insert
to authenticated
with check (
  auth.uid() = author_id
  and private.is_dm_thread_member(dm_messages.thread_id)
);

insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

create policy "authenticated users can upload chat files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'chat-uploads');

create policy "chat files are public"
on storage.objects for select
to public
using (bucket_id = 'chat-uploads');

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.dm_messages;