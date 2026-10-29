-- Velah Books · funções (RPC)

-- Prenda: pré-visualização pública (o código é aleatório e impossível de adivinhar)
create or replace function public.gift_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'from', g.from_name, 'to', g.to_name, 'message', g.message,
    'redeemed', g.redeemed_at is not null,
    'books', (select coalesce(jsonb_agg(jsonb_build_object('slug', b.slug, 'title', b.short) order by b.sort), '[]'::jsonb)
              from public.books b where b.id = any(g.book_ids)))
  from public.gifts g where g.code = p_code;
$$;

create or replace function public.redeem_gift(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.gifts; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login_required'; end if;
  select * into g from public.gifts where code = p_code for update;
  if g.code is null then raise exception 'gift_not_found'; end if;
  if g.redeemed_by is not null and g.redeemed_by <> uid then raise exception 'gift_already_used'; end if;
  insert into public.entitlements(user_id, book_id, source, order_id)
    select uid, unnest(g.book_ids), 'gift', g.order_id on conflict do nothing;
  update public.gifts set redeemed_by = uid, redeemed_at = coalesce(redeemed_at, now()) where code = p_code;
  return (select jsonb_agg(slug order by sort) from public.books where id = any(g.book_ids));
end $$;

-- Código do livro impresso (contracapa)
create or replace function public.redeem_print_code(p_slug text, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c public.print_codes; uid uuid := auth.uid(); bid uuid;
begin
  if uid is null then raise exception 'login_required'; end if;
  select id into bid from public.books where slug = p_slug;
  select * into c from public.print_codes where upper(code) = upper(regexp_replace(p_code, '\s', '', 'g')) and book_id = bid for update;
  if c.code is null then raise exception 'code_not_found'; end if;
  if c.redeemed_by is not null and c.redeemed_by <> uid then raise exception 'code_already_used'; end if;
  insert into public.entitlements(user_id, book_id, source) values (uid, bid, 'print') on conflict do nothing;
  update public.print_codes set redeemed_by = uid, redeemed_at = coalesce(redeemed_at, now()) where code = c.code;
  return true;
end $$;

-- ---------- administração ----------
create or replace function public.admin_import_book(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare b jsonb := p->'book'; bid uuid; aid uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if coalesce(b->>'author','') <> '' then
    select id into aid from public.authors where lower(name) = lower(b->>'author') limit 1;
    if aid is null then insert into public.authors(name) values (b->>'author') returning id into aid; end if;
  end if;
  insert into public.books as t (slug, title, short, sub, author_id, price_cents, status, launch_label, launch_date, event_label,
      series, series_n, badge, blurb, pull, pages, lang, cover, toc, words, sort, featured, updated_at)
  values (b->>'slug', b->>'title', coalesce(nullif(b->>'short',''), b->>'title'), coalesce(b->>'sub',''), aid,
      coalesce((b->>'price_cents')::int, 790), coalesce(b->>'status','draft'), coalesce(b->>'launch_label',''),
      nullif(b->>'launch_date','')::date, coalesce(b->>'event_label',''), nullif(b->>'series',''), nullif(b->>'series_n','')::int,
      coalesce(b->>'badge',''), coalesce(b->>'blurb',''), coalesce(b->>'pull',''), nullif(b->>'pages','')::int,
      coalesce(b->>'lang','pt-PT'), coalesce(b->'cover','{}'::jsonb), coalesce(p->'toc','[]'::jsonb),
      coalesce((p->>'words')::int, 0), coalesce((b->>'sort')::int, 100), coalesce((b->>'featured')::boolean, false), now())
  on conflict (slug) do update set title = excluded.title, short = excluded.short, sub = excluded.sub,
      author_id = coalesce(excluded.author_id, t.author_id), price_cents = excluded.price_cents, status = excluded.status,
      launch_label = excluded.launch_label, launch_date = excluded.launch_date, event_label = excluded.event_label,
      series = excluded.series, series_n = excluded.series_n, badge = excluded.badge, blurb = excluded.blurb, pull = excluded.pull,
      pages = excluded.pages, lang = excluded.lang, cover = excluded.cover, sort = excluded.sort, featured = excluded.featured,
      toc = case when p ? 'chapters' then excluded.toc else t.toc end,
      words = case when p ? 'chapters' then excluded.words else t.words end, updated_at = now()
  returning id into bid;
  if p ? 'chapters' then
    delete from public.chapters where book_id = bid;
    insert into public.chapters(book_id, idx, title, part, md, free, words)
      select bid, (c->>'idx')::int, c->>'title', nullif(c->>'part',''), coalesce(c->>'md',''), coalesce((c->>'free')::boolean,false), coalesce((c->>'words')::int,0)
      from jsonb_array_elements(p->'chapters') c;
  end if;
  return bid;
end $$;

create or replace function public.admin_grant(p_email text, p_slug text) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; bid uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'user_not_found'; end if;
  select id into bid from public.books where slug = p_slug;
  if bid is null then raise exception 'book_not_found'; end if;
  insert into public.entitlements(user_id, book_id, source) values (uid, bid, 'admin') on conflict do nothing;
  return true;
end $$;

create or replace function public.admin_set_role(p_email text, p_role text, p_author text default null) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('reader','author','admin') then raise exception 'bad_role'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'user_not_found'; end if;
  update public.profiles set role = p_role where id = uid;
  if p_role = 'author' and coalesce(p_author,'') <> '' then
    update public.authors set profile_id = uid where lower(name) = lower(p_author);
    if not found then insert into public.authors(name, profile_id) values (p_author, uid); end if;
  end if;
  return true;
end $$;

create or replace function public.admin_create_print_codes(p_slug text, p_n int, p_batch text default '') returns text[]
language plpgsql security definer set search_path = public, extensions as $$
declare bid uuid; out_codes text[] := '{}'; c text; i int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_n < 1 or p_n > 5000 then raise exception 'bad_count'; end if;
  select id into bid from public.books where slug = p_slug;
  if bid is null then raise exception 'book_not_found'; end if;
  while i < p_n loop
    c := 'VELAH-' || upper(substr(translate(encode(extensions.gen_random_bytes(8),'base64'),'+/=0OIl1','XYZ23456'),1,4)) || '-' ||
                     upper(substr(translate(encode(extensions.gen_random_bytes(8),'base64'),'+/=0OIl1','XYZ23456'),1,4));
    begin
      insert into public.print_codes(code, book_id, batch) values (c, bid, coalesce(p_batch,''));
      out_codes := out_codes || c; i := i + 1;
    exception when unique_violation then null;
    end;
  end loop;
  return out_codes;
end $$;

create or replace function public.admin_promo_gift(p_slug text, p_from text, p_to text, p_message text) returns text
language plpgsql security definer set search_path = public as $$
declare bid uuid; c text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select id into bid from public.books where slug = p_slug;
  if bid is null then raise exception 'book_not_found'; end if;
  insert into public.gifts(book_ids, from_name, to_name, message, created_by)
    values (array[bid], coalesce(p_from,''), coalesce(p_to,''), coalesce(p_message,''), auth.uid()) returning code into c;
  return c;
end $$;

-- ---------- painel do autor ----------
create or replace function public.author_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select b.* , a.share from public.books b join public.authors a on a.id = b.author_id
    where a.profile_id = auth.uid() or public.is_admin()
  ), sales as (
    select bid as book_id, count(*) units, sum(o.amount_cents / cardinality(o.book_ids)) gross_cents,
           count(*) filter (where o.paid_at > now() - interval '30 days') units_30,
           count(distinct o.user_id) filter (where o.marketing_ok) contacts
    from public.orders o, unnest(o.book_ids) bid
    where o.status = 'paid' group by bid
  ), owners as (
    select book_id, count(*) n from public.entitlements group by book_id
  ), done as (
    select book_id, ch, count(*) n from public.chapter_done group by book_id, ch
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', m.slug, 'title', m.short, 'status', m.status, 'price_cents', m.price_cents, 'share', m.share,
    'units', coalesce(s.units,0), 'units_30', coalesce(s.units_30,0), 'gross_cents', coalesce(s.gross_cents,0),
    'contacts', coalesce(s.contacts,0), 'owners', coalesce(o.n,0),
    'done', (select coalesce(jsonb_object_agg(d.ch, d.n), '{}'::jsonb) from done d where d.book_id = m.id)
  ) order by m.sort), '[]'::jsonb)
  from mine m left join sales s on s.book_id = m.id left join owners o on o.book_id = m.id;
$$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'readers_7d', (select count(distinct user_id) from public.nights where night > current_date - 7),
    'orders_paid', (select count(*) from public.orders where status = 'paid'),
    'revenue_cents', (select coalesce(sum(amount_cents),0) from public.orders where status = 'paid'),
    'applications', (select count(*) from public.author_applications),
    'print_codes', (select count(*) from public.print_codes),
    'print_redeemed', (select count(*) from public.print_codes where redeemed_at is not null)
  );
end $$;

-- execução: funções de admin e autor só para quem tem sessão
revoke execute on function public.redeem_gift(text), public.redeem_print_code(text,text), public.admin_import_book(jsonb),
  public.admin_grant(text,text), public.admin_set_role(text,text,text), public.admin_create_print_codes(text,int,text),
  public.admin_promo_gift(text,text,text,text), public.author_stats(), public.admin_overview() from public, anon;
grant execute on function public.redeem_gift(text), public.redeem_print_code(text,text), public.admin_import_book(jsonb),
  public.admin_grant(text,text), public.admin_set_role(text,text,text), public.admin_create_print_codes(text,int,text),
  public.admin_promo_gift(text,text,text,text), public.author_stats(), public.admin_overview() to authenticated;
grant execute on function public.gift_preview(text) to anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
