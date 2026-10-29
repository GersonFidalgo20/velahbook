-- Velah Books · esquema v1
-- Uma conta para toda a gente; "author" e "admin" são papéis atribuídos pela RSET.

create extension if not exists pgcrypto;

-- ---------- perfis ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'reader' check (role in ('reader','author','admin')),
  goal int not null default 10 check (goal between 1 and 240),
  tip_seen boolean not null default false,
  marketing_ok boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.admin_emails (email text primary key);
alter table public.admin_emails enable row level security; -- sem políticas: só o servidor lê

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, name, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name',''),
          case when exists(select 1 from public.admin_emails a where lower(a.email) = lower(new.email)) then 'admin' else 'reader' end)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "perfil: ler o próprio" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "perfil: editar o próprio" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (name, goal, tip_seen, marketing_ok) on public.profiles to authenticated;

-- ---------- autores e livros ----------
create table public.authors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  bio text not null default '',
  share numeric(4,3) not null default 0.800 check (share between 0 and 1),
  created_at timestamptz not null default now()
);
alter table public.authors enable row level security;
create policy "autores: leitura pública" on public.authors for select using (true);
create policy "autores: admin" on public.authors for all using (public.is_admin()) with check (public.is_admin());

create table public.books (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+$'),
  title text not null,
  short text not null,
  sub text not null default '',
  author_id uuid references public.authors(id),
  price_cents int not null default 790 check (price_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'draft' check (status in ('draft','soon','presale','ready')),
  launch_label text not null default '',
  launch_date date,
  event_label text not null default '',
  series text,
  series_n int,
  badge text not null default '',
  blurb text not null default '',
  pull text not null default '',
  pages int,
  lang text not null default 'pt-PT',
  cover jsonb not null default '{}'::jsonb,   -- {url} ou {bg, ink, accent, motif}
  toc jsonb not null default '[]'::jsonb,     -- [{t, part, free, w, soon}]
  words int not null default 0,
  sort int not null default 100,
  featured boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.books enable row level security;
create policy "livros: públicos fora de rascunho" on public.books for select using (status <> 'draft' or public.is_admin());
create policy "livros: admin" on public.books for all using (public.is_admin()) with check (public.is_admin());

create table public.bundles (
  slug text primary key,
  title text not null,
  price_cents int not null,
  book_slugs text[] not null,
  active boolean not null default true
);
alter table public.bundles enable row level security;
create policy "packs: leitura pública" on public.bundles for select using (active or public.is_admin());
create policy "packs: admin" on public.bundles for all using (public.is_admin()) with check (public.is_admin());

-- ---------- acesso aos livros ----------
create table public.entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  source text not null check (source in ('purchase','gift','print','admin','bundle')),
  order_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
alter table public.entitlements enable row level security;
create policy "acessos: ver os próprios" on public.entitlements for select using (user_id = auth.uid() or public.is_admin());
create policy "acessos: admin" on public.entitlements for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.owns_book(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.entitlements e where e.user_id = auth.uid() and e.book_id = b);
$$;

-- conteúdo protegido: só capítulos grátis, ou livro pronto e comprado
create table public.chapters (
  book_id uuid not null references public.books(id) on delete cascade,
  idx int not null,
  title text not null,
  part text,
  md text not null default '',
  free boolean not null default false,
  words int not null default 0,
  primary key (book_id, idx)
);
alter table public.chapters enable row level security;
create policy "capítulos: grátis ou comprados" on public.chapters for select using (
  public.is_admin()
  or exists (select 1 from public.books b where b.id = chapters.book_id and b.status in ('presale','ready')
             and (chapters.free or (b.status = 'ready' and public.owns_book(b.id))))
);
create policy "capítulos: admin" on public.chapters for all using (public.is_admin()) with check (public.is_admin());

-- ---------- encomendas, prendas, códigos do impresso ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  item_slug text not null,
  book_ids uuid[] not null,
  amount_cents int not null,
  currency text not null default 'EUR',
  status text not null default 'pending' check (status in ('pending','paid','refunded','failed')),
  is_gift boolean not null default false,
  gift jsonb,
  marketing_ok boolean not null default false,
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.orders enable row level security;
create policy "encomendas: ver as próprias" on public.orders for select using (user_id = auth.uid() or public.is_admin());

create table public.gifts (
  code text primary key default encode(gen_random_bytes(9), 'hex'),
  order_id uuid references public.orders(id) on delete set null,
  book_ids uuid[] not null,
  from_name text not null default '',
  to_name text not null default '',
  message text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.gifts enable row level security;
create policy "prendas: quem ofereceu e admin" on public.gifts for select using (created_by = auth.uid() or public.is_admin());

create table public.print_codes (
  code text primary key,
  book_id uuid not null references public.books(id) on delete cascade,
  batch text not null default '',
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.print_codes enable row level security;
create policy "códigos: admin" on public.print_codes for all using (public.is_admin()) with check (public.is_admin());

-- ---------- leitura (privado de cada leitor) ----------
create table public.positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  ch int not null, pct real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
create table public.highlights (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  ch int not null, text text not null check (length(text) <= 1200),
  color text not null default 'mel' check (color in ('mel','agua','rosa')),
  note text not null default '' check (length(note) <= 4000),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table public.answers (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  book_id uuid not null references public.books(id) on delete cascade,
  ch int not null,
  question text not null default '',
  answer text not null check (length(answer) <= 8000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
create table public.nights (
  user_id uuid not null references auth.users(id) on delete cascade,
  night date not null, minutes real not null default 0,
  primary key (user_id, night)
);
create table public.chapter_done (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  ch int not null, done_at timestamptz not null default now(),
  primary key (user_id, book_id, ch)
);
create table public.reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  ch int not null, value text not null,
  primary key (user_id, book_id, ch)
);
create table public.notify (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
do $$ declare t text; begin
  foreach t in array array['positions','highlights','answers','nights','chapter_done','reactions','notify'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s: só o próprio" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- ---------- candidaturas de autores ----------
create table public.author_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 200),
  message text not null default '' check (length(message) <= 4000),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.author_applications enable row level security;
create policy "candidaturas: qualquer pessoa envia" on public.author_applications for insert to anon, authenticated with check (true);
create policy "candidaturas: admin lê" on public.author_applications for select using (public.is_admin());

-- índices de chaves estrangeiras
create index on public.books(author_id);
create index on public.authors(profile_id);
create index on public.entitlements(book_id);
create index on public.orders(user_id);
create index on public.gifts(created_by);
create index on public.gifts(redeemed_by);
create index on public.gifts(order_id);
create index on public.print_codes(book_id);
create index on public.print_codes(redeemed_by);
create index on public.positions(book_id);
create index on public.highlights(book_id);
create index on public.answers(book_id);
create index on public.chapter_done(book_id);
create index on public.reactions(book_id);
create index on public.notify(book_id);
create index on public.author_applications(user_id);
