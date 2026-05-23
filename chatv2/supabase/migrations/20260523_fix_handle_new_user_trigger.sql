-- Fix handle_new_user trigger to clamp display_name to 2–32 chars
-- Prevents 500 when email prefix is a single character (e.g. a@test.com)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_name text;
  safe_name text;
begin
  raw_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'user'
  );
  -- Ensure 2–32 chars
  safe_name := left(lpad(raw_name, 2, '_'), 32);

  insert into public.profiles (id, display_name, avatar_seed)
  values (
    new.id,
    safe_name,
    regexp_replace(safe_name, '\s+', '-', 'g')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
