-- =====================================================================
-- IPO Alerts update 002: unsubscribe needs a WhatsApp code, public member count
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- =====================================================================

-- One-time codes. No policies on purpose: only the PC sender (service key) can read them.
create table public.unsub_codes (
  id bigint generated always as identity primary key,
  phone text not null,
  code text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,             -- set by the PC sender once WhatsApped
  send_error text,
  attempts int not null default 0, -- wrong guesses
  used_at timestamptz
);
create index on public.unsub_codes (phone, created_at desc);
alter table public.unsub_codes enable row level security;

-- The old "type any number to unsubscribe" function is replaced by the two below
drop function if exists public.unsubscribe(text);

-- Step 1: ask for a code. Returns the same 'sent' whether or not the number is subscribed,
-- so the page never reveals who is on the list.
create or replace function public.request_unsubscribe(p_phone text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_bytes bytea;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;

  -- codes go out over WhatsApp from the PC sender, so it has to be running
  if not exists (select 1 from public.sender_status where wa_state = 'ready' and last_seen > now() - interval '90 seconds') then
    return 'offline';
  end if;
  if exists (select 1 from public.unsub_codes where phone = v_phone and created_at > now() - interval '60 seconds') then
    return 'wait';
  end if;
  if (select count(*) from public.unsub_codes where phone = v_phone and created_at > now() - interval '1 day') >= 5 then
    return 'too_many';
  end if;

  if exists (select 1 from public.subscribers where phone = v_phone and status = 'active') then
    v_bytes := extensions.gen_random_bytes(3);
    insert into public.unsub_codes (phone, code)
    values (v_phone, lpad((((get_byte(v_bytes, 0) << 16) | (get_byte(v_bytes, 1) << 8) | get_byte(v_bytes, 2)) % 1000000)::text, 6, '0'));
  end if;
  return 'sent';
end;
$$;

-- Step 2: check the code and unsubscribe. Codes last 10 minutes, 5 wrong tries each.
create or replace function public.confirm_unsubscribe(p_phone text, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_row public.unsub_codes;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  select * into v_row from public.unsub_codes
  where phone = v_phone and used_at is null order by created_at desc limit 1;

  if not found or v_row.created_at < now() - interval '10 minutes' then return 'expired'; end if;
  if v_row.attempts >= 5 then return 'too_many'; end if;
  if regexp_replace(coalesce(p_code, ''), '\D', '', 'g') <> v_row.code then
    update public.unsub_codes set attempts = attempts + 1 where id = v_row.id;
    return 'wrong';
  end if;

  update public.unsub_codes set used_at = now() where id = v_row.id;
  update public.subscribers set status = 'unsubscribed', unsubscribed_at = now()
  where phone = v_phone and status = 'active';
  return 'unsubscribed';
end;
$$;

-- Number shown on the signup page ("N people already get these alerts")
create or replace function public.subscriber_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.subscribers where status = 'active';
$$;

grant execute on function public.request_unsubscribe(text) to anon, authenticated;
grant execute on function public.confirm_unsubscribe(text, text) to anon, authenticated;
grant execute on function public.subscriber_count() to anon, authenticated;
