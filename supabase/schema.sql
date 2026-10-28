-- =====================================================================
-- IPO Alerts: database schema
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Then add your email to admins (last line of this file).
-- =====================================================================

-- ---------- Admins ----------
-- Emails that may open admin.html (login is an email magic link)
create table public.admins (
  email text primary key
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Subscribers ----------
create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null unique check (phone ~ '^91[6-9][0-9]{9}$'),  -- 91 + 10 digits
  email text not null default '',
  status text not null default 'active' check (status in ('active', 'unsubscribed')),
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  welcomed_at timestamptz,                 -- set by the PC sender after the welcome message
  in_broadcast boolean not null default false, -- you added them to the phone broadcast list
  last_sent_at timestamptz,
  last_error text
);

-- ---------- Sends (one row per "Send" click) ----------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('pc', 'phone')),
  message text not null,                   -- may contain {name}
  line_idx int,                            -- which empty-day line was used (for rotation)
  hot_count int not null default 0,
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'cancelled', 'failed')),
  total int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz
);
create index on public.campaigns (created_at desc);

create table public.deliveries (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  phone text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index on public.deliveries (campaign_id);

-- ---------- PC sender status (single row, updated by the sender) ----------
create table public.sender_status (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  wa_state text not null default 'offline',  -- offline | starting | qr | authenticating | ready
  wa_number text not null default '',
  qr text                                     -- data URL while waiting for a scan
);
insert into public.sender_status (id) values (1);

-- ---------- Public functions (no login needed) ----------
-- Subscribe or re-subscribe. Public users can't read the table, so this is the only way in.
create or replace function public.subscribe(p_name text, p_phone text, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text := lower(trim(coalesce(p_email, '')));
  v_existing public.subscribers;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number'; end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address'; end if;

  select * into v_existing from public.subscribers where phone = v_phone;
  if found then
    update public.subscribers set
      name = coalesce(nullif(left(trim(p_name), 60), ''), name),
      email = coalesce(nullif(v_email, ''), email),
      status = 'active', unsubscribed_at = null, consent_at = now()
    where id = v_existing.id;
    return case when v_existing.status = 'active' then 'updated' else 'resubscribed' end;
  end if;

  insert into public.subscribers (name, phone, email)
  values (left(trim(coalesce(p_name, '')), 60), v_phone, v_email);
  return 'new';
end;
$$;

create or replace function public.unsubscribe(p_phone text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  update public.subscribers set status = 'unsubscribed', unsubscribed_at = now()
  where phone = v_phone and status = 'active';
  return case when found then 'unsubscribed' else 'not_found' end;
end;
$$;

grant execute on function public.subscribe(text, text, text) to anon, authenticated;
grant execute on function public.unsubscribe(text) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Row level security: only admins can read or change anything ----------
alter table public.admins enable row level security;
alter table public.subscribers enable row level security;
alter table public.campaigns enable row level security;
alter table public.deliveries enable row level security;
alter table public.sender_status enable row level security;

create policy "admins read admins" on public.admins for select using (public.is_admin());
create policy "admins manage subscribers" on public.subscribers for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage campaigns" on public.campaigns for all using (public.is_admin()) with check (public.is_admin());
create policy "admins read deliveries" on public.deliveries for select using (public.is_admin());
create policy "admins read sender status" on public.sender_status for select using (public.is_admin());
-- (The PC sender uses the service-role key, which bypasses these rules.)

-- ---------- Your admin email ----------
-- Kept out of this public repo: run this separately in the SQL Editor with your real email.
-- insert into public.admins (email) values ('you@example.com');
