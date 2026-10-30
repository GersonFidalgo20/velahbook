/* ================= Velah · ligação ao Supabase ================= */
// As declarações de função abaixo substituem as versões do protótipo com o mesmo nome.
const CFG = window.VELAH_CONFIG || {};
const sb = (window.supabase && CFG.url && CFG.key) ? window.supabase.createClient(CFG.url, CFG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
}) : null;
let SESSION = null, USER = null, PROFILE = null, BUNDLES = [], BOOK_ROWS = [], BOOTED = false, LOGIN_AFTER = null;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const bookId = slug => (BOOK_ROWS.find(b => b.slug === slug) || {}).id;
const slugOf = id => (BOOK_ROWS.find(b => b.id === id) || {}).slug;
const isAdmin = () => PROFILE?.role === 'admin';
const isAuthorRole = () => ['author', 'admin'].includes(PROFILE?.role);
const appBase = () => location.origin + location.pathname;
function resetContent(){ Object.keys(CACHE).forEach(k => delete CACHE[k]); }
async function fnError(error){ try{ return (await error.context.json()).error || 'error'; }catch(e){ return 'error'; } }
const errMsg = {
  login_required: 'Precisas de entrar na tua conta.', gift_not_found: 'Esta prenda não existe.', gift_already_used: 'Esta prenda já foi aberta noutra conta.',
  code_not_found: 'Código não reconhecido. Confirma as letras no interior da contracapa.', code_already_used: 'Este código já foi usado noutra conta.',
  user_not_found: 'Não há nenhuma conta com esse email. A pessoa tem de entrar na Velah primeiro.', book_not_found: 'Livro não encontrado.', forbidden: 'Sem permissão.'
};
const pgErr = e => { const m = (e && (e.message || e.error_description)) || ''; const k = Object.keys(errMsg).find(k => m.includes(k)); return k ? errMsg[k] : (m || 'Algo correu mal.'); };

/* ---------- catálogo ---------- */
async function loadCatalog(){
  const { data, error } = await sb.from('books')
    .select('id,slug,title,short,sub,price_cents,status,launch_label,launch_date,event_label,series,series_n,badge,blurb,pull,pages,cover,toc,words,sort,featured,print_url,print_label,print_price_cents,edition,authors(name)')
    .order('sort');
  if(error) throw error;
  BOOK_ROWS = data || [];
  BOOKS.length = 0; UPCOMING.length = 0;
  BOOK_ROWS.forEach(r => {
    if(r.status === 'soon'){ UPCOMING.push({ id: r.slug, title: r.short, when: r.launch_label, where: r.event_label }); return; }
    if(r.status === 'draft') return;
    BOOKS.push({ id: r.id, slug: r.slug, title: r.title, short: r.short, sub: r.sub, author: r.authors?.name || '', price: r.price_cents / 100,
      pages: r.pages, status: r.status, badge: r.badge, blurb: r.blurb, pull: r.pull, launch: r.launch_label, cover: r.cover || {}, featured: r.featured,
      printUrl: r.print_url || '', printLabel: r.print_label || '', printPrice: r.print_price_cents, edition: r.edition || '',
      series: r.series ? `${r.series} · Livro ${ROMAN[r.series_n] || r.series_n || ''}` : null, seriesName: r.series, n: r.series_n });
  });
  const pre = BOOK_ROWS.find(r => r.status === 'presale' && r.launch_label); LAUNCH = pre ? pre.launch_label : '';
  const { data: bd } = await sb.from('bundles').select('*').eq('active', true);
  BUNDLES = bd || [];
  BUNDLE = BUNDLES[0] ? { slug: BUNDLES[0].slug, title: BUNDLES[0].title, price: BUNDLES[0].price_cents / 100, books: BUNDLES[0].book_slugs } : null;
  INDEX = {}; BOOK_ROWS.forEach(r => { INDEX[r.slug] = { n: r.toc.length, w: r.words, toc: r.toc }; });
}
async function getIndex(){ if(!INDEX) await loadCatalog(); return INDEX; }
async function getBook(slug){
  if(CACHE[slug]) return CACHE[slug];
  await getIndex();
  const ix = INDEX[slug]; if(!ix) throw new Error('book_not_found');
  const { data, error } = await sb.from('chapters').select('idx,title,part,md,free,words').eq('book_id', bookId(slug)).order('idx');
  if(error) throw error;
  const by = {}; (data || []).forEach(r => by[r.idx] = r);
  const chapters = ix.toc.map((t, i) => { const r = by[i];
    return { t: t.t, part: t.part, md: r ? r.md : '', free: !!t.free, w: t.w || 0, soon: !!t.soon, locked: !r && !t.soon && (t.w || 0) > 0 }; });
  return CACHE[slug] = { slug, chapters };
}
function chapterState(i){
  const c = R.book.chapters[i];
  if(c.soon) return 'soon';
  if(c.md) return 'open';
  return c.locked ? 'locked' : 'soon';
}

/* ---------- sessão e sincronização ---------- */
const SYNC = { prev: null, t: null, running: false, again: false, state: '' };
const USER_KEYS = ['pos', 'hl', 'ans', 'nights', 'done', 'react', 'notify'];
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} scheduleSync(); }
function scheduleSync(){ if(!USER || !SYNC.prev) return; clearTimeout(SYNC.t); SYNC.t = setTimeout(pushSync, 1200); }
function setSyncState(s){ SYNC.state = s; const el = document.getElementById('syncst'); if(el) el.textContent = s === 'err' ? 'Sem ligação · tentamos outra vez' : 'Guardado na tua conta'; }
const snapNow = () => JSON.parse(JSON.stringify({ pos: S.pos, hl: S.hl, ans: S.ans, nights: S.nights, done: S.done, react: S.react, notify: S.notify, prof: { name: S.name || '', goal: S.goal || 10, tip: !!S.tipSeen } }));

async function pullUser(){
  if(!USER){ PROFILE = null; S.role = 'reader'; Object.keys(S.owned).forEach(k => delete S.owned[k]); SYNC.prev = null; return; }
  const uid = USER.id, q = t => sb.from(t).select('*').eq('user_id', uid);
  const [pr, ent, pos, hl, ans, ni, dn, re, no] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(), sb.from('entitlements').select('book_id,created_at').eq('user_id', uid),
    q('positions'), q('highlights'), q('answers'), q('nights'), q('chapter_done'), q('reactions'), q('notify')]);
  PROFILE = pr.data || { name: '', role: 'reader', goal: 10, tip_seen: false };
  Object.keys(S.owned).forEach(k => delete S.owned[k]);
  (ent.data || []).forEach(e => { const s = slugOf(e.book_id); if(s) S.owned[s] = Date.parse(e.created_at); });
  const srv = { pos: {}, hl: {}, ans: {}, nights: {}, done: {}, react: {}, notify: {} };
  (pos.data || []).forEach(p => { const s = slugOf(p.book_id); if(s) srv.pos[s] = { ch: p.ch, pct: p.pct, t: Date.parse(p.updated_at) }; });
  (hl.data || []).forEach(h => { const s = slugOf(h.book_id); if(s) (srv.hl[s] = srv.hl[s] || []).push({ id: h.id, ch: h.ch, text: h.text, color: h.color, note: h.note, t: Date.parse(h.created_at) }); });
  (ans.data || []).forEach(a => { const s = slugOf(a.book_id); if(s) srv.ans[a.key] = { q: a.question, a: a.answer, slug: s, ch: a.ch, t: Date.parse(a.updated_at) }; });
  (ni.data || []).forEach(n => { srv.nights[n.night] = n.minutes; });
  (dn.data || []).forEach(d => { const s = slugOf(d.book_id); if(s) (srv.done[s] = srv.done[s] || {})[d.ch] = Date.parse(d.done_at); });
  (re.data || []).forEach(r => { const s = slugOf(r.book_id); if(s) srv.react[`${s}:${r.ch}`] = r.value; });
  (no.data || []).forEach(n => { const s = slugOf(n.book_id); if(s) srv.notify[s] = true; });
  const prof = { name: PROFILE.name || '', goal: PROFILE.goal || 10, tip: !!PROFILE.tip_seen };
  SYNC.prev = JSON.parse(JSON.stringify({ ...srv, prof }));
  // juntar o que foi feito neste dispositivo antes de entrar (nunca dados de outra conta)
  const keep = !S.syncOwner || S.syncOwner === uid;
  const L = keep ? snapNow() : { pos: {}, hl: {}, ans: {}, nights: {}, done: {}, react: {}, notify: {}, prof: {} };
  const m = JSON.parse(JSON.stringify(srv));
  Object.entries(L.pos || {}).forEach(([s, v]) => { if(!m.pos[s] || (v.t || 0) > (m.pos[s].t || 0)) m.pos[s] = v; });
  Object.entries(L.hl || {}).forEach(([s, l]) => { const ids = new Set((m.hl[s] || []).map(h => h.id)); (l || []).forEach(h => { if(!ids.has(h.id)) (m.hl[s] = m.hl[s] || []).push(h); else m.hl[s] = m.hl[s].map(x => x.id === h.id ? h : x); }); });
  Object.entries(L.ans || {}).forEach(([k, a]) => { if(!m.ans[k] || (a.t || 0) > (m.ans[k].t || 0)) m.ans[k] = a; });
  Object.entries(L.nights || {}).forEach(([d, v]) => { m.nights[d] = Math.max(v || 0, m.nights[d] || 0); });
  Object.entries(L.done || {}).forEach(([s, o]) => { m.done[s] = Object.assign({}, o, m.done[s] || {}); });
  Object.entries(L.react || {}).forEach(([k, v]) => { if(v) m.react[k] = v; });
  Object.entries(L.notify || {}).forEach(([k, v]) => { if(v) m.notify[k] = true; });
  USER_KEYS.forEach(k => { S[k] = m[k]; });
  S.name = prof.name || (keep ? S.name : '') || '';
  S.goal = PROFILE.goal || 10; S.tipSeen = prof.tip || (keep && S.tipSeen) || false;
  S.role = PROFILE.role; S.syncOwner = uid;
  save();
}
async function pushSync(){
  if(!USER || !SYNC.prev) return;
  if(SYNC.running){ SYNC.again = true; return; }
  SYNC.running = true;
  try{
    const uid = USER.id, P = SYNC.prev, cur = snapNow(), ops = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const iso = t => new Date(t || Date.now()).toISOString();
    const posRows = Object.entries(cur.pos || {}).filter(([s, v]) => bookId(s) && v && !same(v, P.pos[s]))
      .map(([s, v]) => ({ user_id: uid, book_id: bookId(s), ch: v.ch, pct: v.pct || 0, updated_at: iso(v.t) }));
    if(posRows.length) ops.push(sb.from('positions').upsert(posRows));
    const flat = o => { const r = {}; Object.entries(o || {}).forEach(([s, l]) => (l || []).forEach(h => r[h.id] = { ...h, slug: s })); return r; };
    const hc = flat(cur.hl), hp = flat(P.hl);
    const hUp = Object.values(hc).filter(h => bookId(h.slug) && !same(h, hp[h.id])).map(h => ({ id: h.id, user_id: uid, book_id: bookId(h.slug), ch: h.ch,
      text: String(h.text).slice(0, 1200), color: h.color, note: String(h.note || '').slice(0, 4000), created_at: iso(h.t) }));
    const hDel = Object.keys(hp).filter(id => !hc[id]);
    if(hUp.length) ops.push(sb.from('highlights').upsert(hUp));
    if(hDel.length) ops.push(sb.from('highlights').delete().eq('user_id', uid).in('id', hDel));
    const aUp = Object.entries(cur.ans || {}).filter(([k, a]) => a && bookId(a.slug) && !same(a, P.ans[k])).map(([k, a]) => ({ user_id: uid, key: k, book_id: bookId(a.slug),
      ch: a.ch, question: String(a.q || '').slice(0, 500), answer: String(a.a).slice(0, 8000), updated_at: iso(a.t) }));
    const aDel = Object.keys(P.ans || {}).filter(k => !(cur.ans || {})[k]);
    if(aUp.length) ops.push(sb.from('answers').upsert(aUp));
    if(aDel.length) ops.push(sb.from('answers').delete().eq('user_id', uid).in('key', aDel));
    const nUp = Object.entries(cur.nights || {}).filter(([d, v]) => v !== (P.nights || {})[d]).map(([d, v]) => ({ user_id: uid, night: d, minutes: v }));
    if(nUp.length) ops.push(sb.from('nights').upsert(nUp));
    const dUp = []; Object.entries(cur.done || {}).forEach(([s, o]) => Object.entries(o || {}).forEach(([ch, t]) => { if(!((P.done || {})[s] && P.done[s][ch]) && bookId(s)) dUp.push({ user_id: uid, book_id: bookId(s), ch: +ch, done_at: iso(t) }); }));
    if(dUp.length) ops.push(sb.from('chapter_done').upsert(dUp));
    const rUp = [];
    new Set([...Object.keys(cur.react || {}), ...Object.keys(P.react || {})]).forEach(k => {
      const v = (cur.react || {})[k] || null, pv = (P.react || {})[k] || null; if(v === pv) return;
      const [s, ch] = k.split(':'); const b = bookId(s); if(!b) return;
      if(v) rUp.push({ user_id: uid, book_id: b, ch: +ch, value: v }); else ops.push(sb.from('reactions').delete().eq('user_id', uid).eq('book_id', b).eq('ch', +ch));
    });
    if(rUp.length) ops.push(sb.from('reactions').upsert(rUp));
    new Set([...Object.keys(cur.notify || {}), ...Object.keys(P.notify || {})]).forEach(s => {
      const v = !!(cur.notify || {})[s], pv = !!(P.notify || {})[s]; if(v === pv || !bookId(s)) return;
      ops.push(v ? sb.from('notify').upsert({ user_id: uid, book_id: bookId(s) }) : sb.from('notify').delete().eq('user_id', uid).eq('book_id', bookId(s)));
    });
    if(!same(cur.prof, P.prof)) ops.push(sb.from('profiles').update({ name: String(cur.prof.name).slice(0, 60), goal: cur.prof.goal, tip_seen: cur.prof.tip }).eq('id', uid));
    const res = await Promise.all(ops);
    const bad = res.find(r => r && r.error); if(bad) throw bad.error;
    SYNC.prev = cur; setSyncState('ok');
  }catch(e){ console.warn('sync', e); setSyncState('err'); setTimeout(scheduleSync, 8000); }
  finally{ SYNC.running = false; if(SYNC.again){ SYNC.again = false; scheduleSync(); } }
}
document.addEventListener('visibilitychange', () => { if(document.hidden) pushSync(); });

/* ---------- entrar / sair ---------- */
function loginCard(text){
  return `<div class="logincard">${symSVG(40, 31, 'var(--wick)', 'var(--paper)')}<div><b>Entra na Velah</b><span>${text}</span></div><button class="btn primary" data-login>Entrar</button></div>`;
}
function loginModal(reason, after){
  LOGIN_AFTER = after || null;
  try{ localStorage.setItem('velah.after', location.hash || '#biblioteca'); }catch(e){}
  layer.innerHTML = `<div class="scrim" data-close><div class="modal" role="dialog" aria-modal="true" aria-labelledby="lgt">
    <div class="login-mark">${symSVG(46, 36, 'var(--wick)', 'var(--paper)')}</div>
    <h2 id="lgt">${esc(reason || 'Entrar na Velah')}</h2>
    <p style="color:var(--dim);margin:0 0 16px">Sem palavra-passe. Enviamos-te um email com um link e um código de entrada.</p>
    <form id="lgf"><div class="field"><label for="lg-email">O teu email</label><input id="lg-email" type="email" required autocomplete="email" inputmode="email" placeholder="nome@email.com"></div>
      <button class="btn primary" style="width:100%" id="lg-send">Enviar link de entrada</button></form>
    <form id="lgc" hidden><p class="lg-sent"></p><div class="field"><label for="lg-code">Código de 6 dígitos</label><input id="lg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></div>
      <button class="btn primary" style="width:100%">Entrar com o código</button><button type="button" class="btn ghost" style="width:100%;margin-top:8px" data-lgback>Usar outro email</button></form>
    <p class="fine">Ao entrar aceitas os <a href="#termos" data-close>termos</a> e a <a href="#privacidade" data-close>política de privacidade</a>.</p>
  </div></div>`;
  const f = document.getElementById('lgf'), c = document.getElementById('lgc');
  setTimeout(() => document.getElementById('lg-email')?.focus(), 50);
  f.onsubmit = async e => {
    e.preventDefault(); const email = document.getElementById('lg-email').value.trim(); const btn = document.getElementById('lg-send');
    btn.disabled = true; btn.innerHTML = '<span class="spin" aria-label="A enviar"></span>';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: appBase(), shouldCreateUser: true } });
    btn.disabled = false; btn.textContent = 'Enviar link de entrada';
    if(error){ toast(/rate|limit/i.test(error.message) ? 'Demasiados pedidos. Espera um minuto.' : 'Não foi possível enviar o email.'); return; }
    f.hidden = true; c.hidden = false; c.dataset.email = email;
    c.querySelector('.lg-sent').innerHTML = `Enviámos um email para <b>${esc(email)}</b>. Abre o link neste dispositivo ou escreve aqui o código.`;
    document.getElementById('lg-code').focus();
  };
  c.onsubmit = async e => {
    e.preventDefault(); const token = document.getElementById('lg-code').value.replace(/\D/g, '');
    const { error } = await sb.auth.verifyOtp({ email: c.dataset.email, token, type: 'email' });
    if(error){ c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); toast('Código inválido ou expirado'); return; }
  };
  c.querySelector('[data-lgback]').onclick = () => { c.hidden = true; f.hidden = false; };
}
async function logout(){
  await pushSync();
  await sb.auth.signOut();
  USER_KEYS.forEach(k => S[k] = {}); S.name = ''; S.syncOwner = null; S.tipSeen = false;
  try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){}
  toast('Sessão terminada');
}
document.addEventListener('click', e => {
  if(e.target.closest('[data-login]')){ e.preventDefault(); toggleMenu(false); loginModal(); }
  else if(e.target.closest('[data-logout]')){ e.preventDefault(); toggleMenu(false); logout(); }
});
if(sb) sb.auth.onAuthStateChange((ev, session) => {
  SESSION = session; USER = session?.user || null;
  if(!BOOTED || !['SIGNED_IN', 'SIGNED_OUT'].includes(ev)) return;
  setTimeout(async () => {
    try{ await pullUser(); }catch(e){ console.error(e); }
    resetContent(); renderAcct();
    if(ev === 'SIGNED_IN'){
      if(layer.querySelector('#lgf')) layer.innerHTML = '';
      toast('Bem-vindo à Velah' + (S.name ? ', ' + S.name : ''));
      const after = LOGIN_AFTER; LOGIN_AFTER = null;
      if(after){ after(); return; }
    }
    route();
  }, 0);
});

function renderAcct(){
  acctBtn.innerHTML = (USER && initials(S.name || USER.email)) || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  acctBtn.dataset.author = isAuthorRole() ? '1' : '0';
  if(!USER){
    acctMenu.innerHTML = `<div class="who"><b>Visitante</b><span>Entra para comprar e guardar a tua biblioteca</span></div>
      <a role="menuitem" href="#" data-login>Entrar ou criar conta</a><a role="menuitem" href="#autores">Publicar na Velah</a>`;
    return;
  }
  const roleL = { admin: 'Administração RSET', author: 'Leitor e autor na Velah', reader: 'Conta de leitor' }[PROFILE?.role || 'reader'];
  acctMenu.innerHTML = `<div class="who"><b>${esc(S.name || USER.email)}</b><span>${esc(roleL)}${S.name ? ' · ' + esc(USER.email) : ''}</span></div>
    <a role="menuitem" href="#biblioteca">A minha biblioteca</a><a role="menuitem" href="#caderno">O meu caderno</a>
    ${isAuthorRole() ? '<a role="menuitem" href="#autor">Painel do autor <small>Autor</small></a>' : '<a role="menuitem" href="#autores">Publicar na Velah</a>'}
    ${isAdmin() ? '<a role="menuitem" href="#admin">Administração <small>RSET</small></a>' : ''}
    <a role="menuitem" href="#" data-logout>Terminar sessão</a>
    <div class="sim"><p id="syncst">${SYNC.state === 'err' ? 'Sem ligação · tentamos outra vez' : 'Guardado na tua conta'}</p></div>`;
}

/* ---------- avisos de lançamento ---------- */
function toggleNotify(n){
  if(!USER){ loginModal('Entra para receberes o aviso', () => { route(); }); return; }
  const id = n.dataset.notify; S.notify[id] = !S.notify[id]; save();
  n.textContent = S.notify[id] ? 'Aviso ativo' : 'Avisar-me'; toast(S.notify[id] ? 'Vais receber um aviso no lançamento' : 'Aviso removido');
}

/* ---------- compra ---------- */
function openCheckout(slug){
  if(isFree(bySlug(slug))){ claimFree(slug); return; }
  if(!USER){ loginModal('Entra para comprar', () => { route(); openCheckout(slug); }); return; }
  const isB = BUNDLES.some(b => b.slug === slug);
  const item = isB ? BUNDLE : bySlug(slug); if(!item) return;
  const pre = isB || item.status === 'presale';
  const books = isB ? BUNDLE.books : [slug];
  const render = (busy, msg) => {
    layer.innerHTML = `<div class="scrim" data-close><div class="modal" role="dialog" aria-modal="true" aria-labelledby="ckt">
      <h2 id="ckt">${pre ? 'Reservar' : 'Comprar'}</h2>
      <div class="order">${isB ? `<div class="fan" style="width:110px;height:80px">${books.map(s => coverEl(s)).join('')}</div>` : coverEl(slug)}<div style="min-width:0"><b>${esc(item.title)}</b><span style="color:var(--dim);font-size:13px">${isB ? books.length + ' livros' : esc(item.author) + ' · livro digital'}</span></div><span class="price" style="margin-left:auto">${eur(item.price)}</span></div>
      <div class="field"><label for="ck-name">O teu nome</label><input id="ck-name" value="${esc(S.name)}" placeholder="Ex.: Ana Gabriela" autocomplete="name" maxlength="60"></div>
      <label class="giftt"><input type="checkbox" id="ck-gift"> É uma prenda para outra pessoa</label>
      <div id="giftf" hidden><div class="field"><label for="ck-to">Para quem</label><input id="ck-to" placeholder="Ex.: Pedro" autocomplete="off" maxlength="40"></div>
      <div class="field"><label for="ck-msg">Mensagem (opcional)</label><textarea id="ck-msg" rows="2" maxlength="160" placeholder="Para leres à noite, como eu."></textarea></div></div>
      <label style="display:flex;gap:8px;font-size:13px;color:var(--dim);margin-bottom:12px"><input type="checkbox" id="ck-opt" checked style="accent-color:var(--wick)"> Aceito que o autor me contacte sobre novos livros e eventos</label>
      <p class="paynote">Pagas no ecrã seguro do Stripe: MB WAY, cartão, Apple Pay ou Google Pay. IVA incluído. Recebes a fatura por email.</p>
      ${msg ? `<div class="demo-note">${msg}</div>` : ''}
      <button class="btn primary" id="ck-pay" style="width:100%" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin" aria-label="A abrir o pagamento"></span>' : `Pagar ${eur(item.price)}`}</button>
    </div></div>`;
    const gt = document.getElementById('ck-gift'); gt.onchange = () => { document.getElementById('giftf').hidden = !gt.checked; if(gt.checked) document.getElementById('ck-to').focus(); };
    document.getElementById('ck-pay').onclick = async () => {
      const nm = document.getElementById('ck-name').value.trim(); if(nm && nm !== S.name){ S.name = nm.slice(0, 60); save(); }
      const gift = gt.checked ? { to: document.getElementById('ck-to').value.trim(), message: document.getElementById('ck-msg').value.trim(), from: S.name } : null;
      const marketing_ok = document.getElementById('ck-opt').checked;
      render(true);
      const { data, error } = await sb.functions.invoke('create-checkout', { body: { item: slug, gift, marketing_ok, return_url: appBase() } });
      if(data && data.url){ location.href = data.url; return; }
      const code = error ? await fnError(error) : 'error';
      render(false, code === 'payments_not_configured' ? 'Os pagamentos ainda não estão ativos nesta beta. A tua intenção de compra ficou registada e avisamos-te quando abrirem.' :
        code === 'login_required' ? 'A tua sessão expirou. Entra outra vez.' : 'Não foi possível abrir o pagamento. Tenta outra vez dentro de instantes.');
    };
  };
  render(false);
}
async function vThanks(orderId){
  view.innerHTML = `<div class="gate"><span class="spin" style="border-color:var(--line);border-top-color:var(--wick);width:34px;height:34px"></span><h1>A confirmar o pagamento…</h1><p>Isto demora poucos segundos. Não feches esta página.</p></div>`;
  for(let i = 0; i < 45; i++){
    const { data: o } = await sb.from('orders').select('id,status,is_gift,item_slug,book_ids').eq('id', orderId).maybeSingle();
    if(o && o.status === 'paid'){
      if(o.is_gift){
        const { data: g } = await sb.from('gifts').select('code,to_name').eq('order_id', orderId).maybeSingle();
        if(g){ view.innerHTML = `<div class="gate">${giftDoneHTML({ code: g.code, to: g.to_name, slug: slugOf(o.book_ids[0]), title: (BUNDLES.find(b => b.slug === o.item_slug) || {}).title || bySlug(slugOf(o.book_ids[0]))?.short })}</div>`; burstAt(view.querySelector('.gate')); return; }
      } else {
        await pullUser(); resetContent();
        const s = slugOf(o.book_ids[0]);
        view.innerHTML = `<div class="gate qrgate">${coverEl(s)}<div class="eyebrow">Pagamento confirmado</div><h1>Está na tua biblioteca</h1><p>Boa leitura. O leitor guarda o ponto onde paras, em todos os teus dispositivos.</p><div class="row"><a class="btn primary" href="#ler-${s}">Começar a ler</a><a class="btn ghost" href="#biblioteca">Ver a biblioteca</a></div></div>`;
        burstAt(view.querySelector('.cover')); buzz([10, 40, 10]); return;
      }
    }
    if(o && o.status === 'failed'){ view.innerHTML = `<div class="empty"><h2>O pagamento não foi concluído</h2><p>Nada foi cobrado. Podes tentar outra vez a partir da página do livro.</p><a class="btn primary" href="#loja">Voltar à loja</a></div>`; return; }
    await new Promise(r => setTimeout(r, 2000));
  }
  view.innerHTML = `<div class="empty"><h2>Ainda à espera da confirmação</h2><p>Alguns métodos, como o Multibanco, demoram mais. O livro aparece na biblioteca assim que o pagamento chegar, e enviamos-te um email.</p><a class="btn primary" href="#biblioteca">Ir para a biblioteca</a></div>`;
}

/* ---------- prendas ---------- */
function giftLink(code){ return appBase() + '#prenda-' + code; }
function giftDoneHTML(g){
  return `<div class="done"><div class="giftbox mini">${coverEl(g.slug)}</div><h2 id="ckt">Prenda pronta</h2>
    <p style="color:var(--dim)"><i>${esc(g.title || '')}</i> para ${esc(g.to || 'alguém especial')}. Envia este link: quem o abrir desembrulha o livro e fica com ele na biblioteca.</p>
    <div class="giftlink"><input readonly value="${esc(giftLink(g.code))}" aria-label="Link da prenda"><button class="btn primary small" data-copygift>Copiar</button></div>
    <div class="row" style="justify-content:center;margin-top:12px"><a class="btn ghost" href="#prenda-${g.code}">Ver como fica</a></div></div>`;
}
async function vGift(code){
  const { data: g, error } = await sb.rpc('gift_preview', { p_code: code });
  if(error || !g || !(g.books || []).length){ view.innerHTML = `<div class="empty"><h2>Esta prenda não abriu</h2><p>O link parece incompleto. Pede a quem ta ofereceu que o envie outra vez.</p></div>`; return; }
  const books = g.books, title = books.length > 1 ? books.length + ' livros' : books[0].title;
  view.innerHTML = `<div class="gift-stage">
    <div class="eyebrow">Uma prenda para ${esc(g.to || 'ti')}</div>
    <h1>${esc(g.from || 'Alguém')} ofereceu-te ${books.length > 1 ? 'livros' : 'um livro'}</h1>
    <button class="giftbox" data-unwrap aria-label="Abrir a prenda"><span class="lid"></span><span class="ribbon"></span><span class="gcover">${coverEl(books[0].slug)}</span><span class="tap">Toca para abrir</span></button>
    <div class="gift-msg" hidden>
      ${g.message ? `<blockquote>«${esc(g.message)}»<span>${esc(g.from || '')}</span></blockquote>` : ''}
      <p><b>${esc(title)}</b> é teu. Fica na tua biblioteca Velah, para ler à noite.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-claim>Guardar na minha biblioteca</button></div>
    </div></div>`;
  view.querySelector('[data-unwrap]').onclick = ev => { const gb = ev.currentTarget; if(gb.classList.contains('open')) return; gb.classList.add('open'); buzz([10, 30, 10]); setTimeout(() => { burstAt(gb); view.querySelector('.gift-msg').hidden = false; }, RM ? 0 : 450); };
  const claim = async () => {
    if(!USER){ loginModal('Entra para guardares a prenda', claim); return; }
    const { data: slugs, error: e2 } = await sb.rpc('redeem_gift', { p_code: code });
    if(e2){ toast(pgErr(e2)); return; }
    await pullUser(); resetContent(); toast('Está na tua biblioteca');
    location.hash = 'ler-' + (slugs && slugs[0] || books[0].slug);
  };
  view.querySelector('[data-claim]').onclick = claim;
}

/* ---------- livro impresso ---------- */
function vQR(arg){
  const [slug, pre] = String(arg).split('/');
  const b = bySlug(slug); if(!b || b.status !== 'ready'){ location.hash = 'loja'; return; }
  const done = owns(slug);
  view.innerHTML = `<div class="gate qrgate">${coverEl(slug)}
    <div class="eyebrow">Livro impresso + digital</div><h1>${done ? 'Já está na tua biblioteca' : 'Desbloqueia o digital'}</h1>
    <p>${done ? `O <i>${esc(b.short)}</i> digital já é teu. Lê à noite, com luz âmbar e o teu caderno.` : `Compraste <i>${esc(b.short)}</i> em papel? Escreve o código que está no interior da contracapa e o livro digital fica na tua conta, sem pagar outra vez.`}</p>
    ${done ? `<div class="row"><a class="btn primary" href="#ler-${slug}">Abrir no leitor</a></div>` : `<form class="qrform" autocomplete="off"><input id="qrc" placeholder="VELAH-XXXX-XXXX" aria-label="Código da contracapa" maxlength="24" value="${esc(pre || '')}"><button class="btn primary">Desbloquear</button></form>${USER ? '' : '<p class="qrhint">Vais precisar de entrar com o teu email, para o livro ficar guardado na tua conta.</p>'}`}</div>`;
  const f = view.querySelector('.qrform'); if(!f) return;
  const go_ = async () => {
    const v = document.getElementById('qrc').value.trim();
    if(!USER){ loginModal('Entra para desbloquear o livro', () => { location.hash = 'qr-' + slug + '/' + v; route(); }); return; }
    const { error } = await sb.rpc('redeem_print_code', { p_slug: slug, p_code: v });
    if(error){ f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); toast(pgErr(error)); return; }
    await pullUser(); resetContent(); buzz([10, 40, 10]); burstAt(view.querySelector('.cover')); toast('Desbloqueado · bem-vindo à Velah'); vQR(slug);
  };
  f.onsubmit = e => { e.preventDefault(); go_(); };
}

/* ---------- autores ---------- */
function vGate(){
  view.innerHTML = `<div class="gate"><div class="eyebrow">Painel do autor</div><h1>Esta área é para autores da Velah</h1>
    <p>${USER ? 'A tua conta é de leitor.' : 'Entra com a tua conta.'} Quando publicas com a RSET Publisher, ativamos o acesso de autor nesta mesma conta: o mesmo login, mais um painel com vendas, receitas e leitores.</p>
    <div class="row"><a class="btn primary" href="#autores">Como publicar na Velah</a>${USER ? '' : '<button class="btn ghost" data-login>Entrar</button>'}</div></div>`;
}
function vForAuthors(){
  view.innerHTML = `
  <section class="authors" style="margin-top:8px">
    <div><div class="eyebrow">Velah para autores</div>
      <h2>O teu livro, os teus leitores, a tua margem.</h2>
      <p style="color:var(--dim);margin:0 0 18px">A Velah é uma loja escolhida a dedo. Publicamos livros de desenvolvimento pessoal feitos com a RSET Publisher, com capa da Coleção Velah e um leitor pensado para a noite.</p>
      <div class="row"><button class="btn primary" data-apply>Quero publicar na Velah</button>${isAuthorRole() ? '<a class="btn ghost" href="#autor">Abrir o meu painel</a>' : ''}</div>
    </div>
    <ul>
      <li><b>80%</b><span><strong>do valor líquido de cada venda é do autor.</strong> A partir de 7,90 €, recebes mais de 5 € por livro.</span></li>
      <li><b>1:1</b><span><strong>Os leitores ficam teus.</strong> Nome e email de quem compra, com consentimento, para o próximo lançamento.</span></li>
      <li><b>48 h</b><span><strong>Do manuscrito final à loja.</strong> O mesmo ficheiro que vai para a gráfica passa a livro digital.</span></li>
    </ul>
  </section>
  <section class="sec">
    <div class="sec-head"><div><div class="eyebrow">Como funciona</div><h2>Uma conta, duas áreas</h2></div><p>Continuas a ser leitor: compras e lês como toda a gente. O painel de autor aparece no menu da tua conta quando o teu livro entra na loja.</p></div>
    <div class="steps">
      <div><b>Candidatas-te</b><span>Contas-nos a ideia ou envias o manuscrito.</span></div>
      <div><b>Escrevemos contigo</b><span>Um Programa de Autor RSET leva o livro até à versão final.</span></div>
      <div><b>Ativamos o teu acesso</b><span>A tua conta Velah ganha o painel de autor.</span></div>
      <div><b>Publicas e vendes</b><span>O livro entra na loja e acompanhas vendas e leitores.</span></div>
    </div>
  </section>`;
  view.querySelector('[data-apply]').onclick = applyModal;
}
function applyModal(){
  layer.innerHTML = `<div class="scrim" data-close><div class="modal" role="dialog" aria-modal="true" aria-labelledby="apt">
    <h2 id="apt">Quero publicar na Velah</h2><p style="color:var(--dim);margin:0 0 14px">Conta-nos quem és e o livro que tens em mente. A equipa RSET responde-te por email.</p>
    <form id="apf"><div class="field"><label for="ap-n">Nome</label><input id="ap-n" required maxlength="120" value="${esc(S.name || '')}"></div>
    <div class="field"><label for="ap-e">Email</label><input id="ap-e" type="email" required maxlength="200" value="${esc(USER?.email || '')}"></div>
    <div class="field"><label for="ap-m">O teu livro</label><textarea id="ap-m" rows="4" maxlength="4000" placeholder="Tema, para quem é, em que fase está."></textarea></div>
    <button class="btn primary" style="width:100%">Enviar candidatura</button></form></div></div>`;
  document.getElementById('apf').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from('author_applications').insert({ name: document.getElementById('ap-n').value.trim(), email: document.getElementById('ap-e').value.trim(), message: document.getElementById('ap-m').value.trim(), user_id: USER?.id || null });
    if(error){ toast('Não foi possível enviar. Tenta outra vez.'); return; }
    layer.innerHTML = ''; toast('Candidatura enviada. Obrigado!'); burst(innerWidth / 2, innerHeight / 2);
  };
}
const VAT = .06, FEE_P = .015, FEE_F = .25, TAXF = .005;
const netOf = p => { const ex = p / (1 + VAT); return ex - (p * FEE_P + FEE_F) - p * TAXF; };
async function vAuthor(){
  if(!USER || !isAuthorRole()){ vGate(); return; }
  view.innerHTML = `<div class="gate"><span class="spin" style="border-color:var(--line);border-top-color:var(--wick)"></span></div>`;
  const { data, error } = await sb.rpc('author_stats');
  if(error){ view.innerHTML = `<div class="empty"><h2>Não foi possível abrir o painel</h2><p>${esc(pgErr(error))}</p></div>`; return; }
  const rows = (data || []).map(r => { const p = r.price_cents / 100, unitRoyal = netOf(p) * r.share; return { ...r, price: p, royal: r.units * unitRoyal, unitRoyal }; });
  const T = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const first = rows.find(r => r.status === 'ready') || rows[0];
  const ret = r => { const ix = INDEX[r.slug]; if(!ix || !r.owners) return ''; return ix.toc.map((c, i) => { const v = Math.round(100 * ((r.done || {})[i] || 0) / r.owners);
      return `<div class="r"><span title="${esc(c.t)}">${esc(c.t.length > 26 ? c.t.slice(0, 25) + '…' : c.t)}</span><span class="t"><i style="width:${v}%"></i></span><span>${v}%</span></div>`; }).join(''); };
  view.innerHTML = `
    <div class="dash-head"><div><div class="eyebrow">Painel do autor · ${esc(S.name || USER.email)}</div><h1>Os teus livros na Velah Books</h1></div></div>
    <div class="kpis">
      <div class="kpi"><span>Vendas</span><b>${int(T('units'))}</b><small>${int(T('units_30'))} nos últimos 30 dias</small></div>
      <div class="kpi"><span>Receita bruta</span><b>${eur(T('gross_cents') / 100)}</b><small>IVA incluído</small></div>
      <div class="kpi"><span>Os teus royalties</span><b style="color:var(--wick)">${eur(T('royal'))}</b><small>80% do valor líquido</small></div>
      <div class="kpi"><span>Leitores com os teus livros</span><b>${int(T('owners'))}</b><small>${int(T('owners_30'))} nos últimos 30 dias</small></div>
    </div>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><span>Pediram o livro impresso</span><b style="color:var(--wick)">${int(T('print_interest'))}</b><small>leitores à espera do papel</small></div>
      <div class="kpi"><span>Cliques para comprar o impresso</span><b>${int(T('print_clicks'))}</b><small>a partir da Velah</small></div>
      <div class="kpi"><span>Leitores com contacto</span><b>${int(T('contacts'))}</b><small>aceitaram ser contactados</small></div>
    </div>
    ${T('units') === 0 ? '<p class="note" style="margin-top:14px">Ainda sem vendas. Os números aparecem aqui em tempo real a partir do lançamento.</p>' : ''}
    <div class="two">
      <div class="panelbox"><h3>Por livro</h3><p class="hint">Livros grátis contam como leitores; os pedidos do impresso são o funil para a venda em papel.</p>
        <div class="tablewrap"><table><thead><tr><th>Livro</th><th>Preço</th><th>Leitores</th><th>Querem o impresso</th><th>Vendas</th><th>Royalties</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="book">${coverEl(r.slug)}<span>${esc(r.title)}${r.status === 'presale' ? ' <span class="chip gold">pré-venda</span>' : ''}</span></td><td>${r.price ? eur(r.price) : 'Grátis'}</td><td>${int(r.owners)}</td><td style="color:var(--wick);font-weight:600">${int(r.print_interest)}</td><td>${int(r.units)}</td><td>${eur(r.royal)}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="panelbox"><h3>Até onde leem</h3><p class="hint">${first ? esc(first.title) + ' · % de quem tem o livro e terminou cada capítulo' : ''}</p><div class="compare">${first ? ret(first) || '<span class="hint">Aparece quando houver leitores.</span>' : ''}</div></div>
    </div>`;
}

/* ---------- textos legais (rascunho a validar por jurista) ---------- */
function vLegal(kind){
  const T = {
    termos: ['Termos e condições', `<p>A Velah Books é uma plataforma da RSET Publisher para venda de livros digitais. Ao criar conta e comprar, aceitas estes termos.</p>
      <h3>Compra e acesso</h3><p>Cada livro é comprado uma vez, sem subscrição, e fica disponível na tua conta para leitura pessoal no leitor Velah. Os livros em pré-venda abrem na data de lançamento indicada.</p>
      <h3>Direito de livre resolução</h3><p>Nos conteúdos digitais, ao começares a ler um livro comprado reconheces que perdes o direito de livre resolução de 14 dias, nos termos da lei aplicável. Se não abriste o livro, podes pedir o reembolso nesse prazo.</p>
      <h3>Uso pessoal</h3><p>Os livros têm direitos de autor. Não é permitido copiar, distribuir ou revender o conteúdo. Cada exemplar mostra o nome de quem o comprou.</p>
      <h3>Livro de Reclamações</h3><p>Podes apresentar reclamação no Livro de Reclamações Eletrónico, em livroreclamacoes.pt.</p>`],
    privacidade: ['Política de privacidade', `<p>Tratamos apenas os dados necessários para a tua conta, as tuas compras e a tua leitura: email, nome, livros, ponto de leitura, sublinhados, notas e respostas do caderno.</p>
      <h3>O que fica privado</h3><p>O teu caderno, sublinhados, respostas e noites de leitura são só teus. Os autores veem apenas números agregados (por exemplo, quantos leitores terminaram cada capítulo).</p>
      <h3>Contacto dos autores</h3><p>Só partilhamos o teu nome e email com o autor se o autorizares no momento da compra. Podes retirar essa autorização a qualquer momento.</p>
      <h3>Os teus direitos</h3><p>Podes pedir acesso, correção ou eliminação dos teus dados a qualquer momento através do email da RSET Publisher. Os pagamentos são processados pela Stripe e não guardamos dados de cartão.</p>`]
  }[kind];
  view.innerHTML = `<article class="legal"><div class="eyebrow">Velah Books · rascunho em revisão jurídica</div><h1>${T[0]}</h1>${T[1]}</article>`;
}

/* ---------- capa genérica (livros novos) ---------- */
function coverUrl(slug){ const b = bySlug(slug) || BOOK_ROWS.find(r => r.slug === slug); return b && b.cover && b.cover.url; }

/* ---------- arranque ---------- */
async function route(){
  const h = (location.hash || '#loja').slice(1);
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', h.startsWith(a.dataset.nav) ? 'page' : 'false'));
  try{
    await getIndex();
    if(h.startsWith('ler-')){
      const [, slug, ch] = h.match(/^ler-([a-z0-9]+)(?:-(\d+))?$/) || [];
      if(R.el.hidden || R.slug !== slug) await openReader(slug, ch != null ? +ch : null);
      else if(ch != null && +ch !== R.ch){ R.ch = +ch; renderChapter(0); }
      return;
    }
    if(!R.el.hidden) closeReader();
    if(h.startsWith('livro-')) await vBook(h.slice(6));
    else if(h === 'biblioteca') await vLibrary();
    else if(h === 'autor') await vAuthor();
    else if(h === 'autores') vForAuthors();
    else if(h === 'caderno') await vNotebook();
    else if(h.startsWith('qr-')) vQR(h.slice(3));
    else if(h.startsWith('prenda-')) await vGift(h.slice(7));
    else if(h.startsWith('obrigado-')) await vThanks(h.slice(9));
    else if(h.startsWith('admin')) await (isAdmin() ? vAdmin(h.split('/')[1]) : vGate());
    else if(h === 'termos' || h === 'privacidade') vLegal(h);
    else vStore();
    window.scrollTo(0, 0);
  }catch(err){
    view.innerHTML = `<div class="empty"><h2>Não foi possível abrir esta página</h2><p>Verifica a tua ligação à internet e tenta outra vez.</p><button class="btn primary" onclick="location.reload()">Tentar outra vez</button></div>`;
    console.error(err);
  }
}
async function boot(){
  if(!sb){ view.innerHTML = `<div class="empty"><h2>Configuração em falta</h2><p>Falta o ficheiro config.js com o endereço e a chave pública do Supabase.</p></div>`; return; }
  try{
    const { data } = await sb.auth.getSession(); SESSION = data.session; USER = SESSION?.user || null;
    await loadCatalog(); await pullUser();
  }catch(e){ console.error(e); }
  BOOTED = true; renderAcct();
  let after = null; try{ after = localStorage.getItem('velah.after'); if(USER && after) localStorage.removeItem('velah.after'); }catch(e){}
  if(USER && after && location.hash !== after && !location.hash){ location.hash = after; } else route();
}

/* ---------- Coleção Velah: capa automática para livros novos ---------- */
function genericCover(b){
  const u = 'g' + (++uid), c = b.cover || {};
  if(c.url) return `<img src="${esc(c.url)}" alt="Capa: ${esc(b.short || '')}" loading="lazy">`;
  const pal = ['#6e2033', '#15262B', '#2e6b67', '#c48a2c', '#a9443a', '#262a48', '#9aa596', '#cf6d36', '#3d4f2f', '#5b3a5e', '#1f4d4a', '#8c6416'];
  const hash = [...String(b.slug || 'x')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const bg = c.bg || pal[hash % pal.length];
  const rgb = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16) / 255), lum = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  const cream = '#EAE5D9', gold = '#E3B062', ink = '#0D1A1E', fg = lum > .55 ? ink : cream;
  const motif = c.motif || (b.n ? 'numero' : ['linha', 'circulo', 'arco'][hash % 3]);
  const words = String(b.short || b.title || '').split(/\s+/); const lines = []; let cur = '';
  words.forEach(w => { const t = cur ? cur + ' ' + w : w; if(t.length > 13 && cur){ lines.push(cur); cur = w; } else cur = t; }); if(cur) lines.push(cur);
  const fs = lines.length > 3 ? 30 : lines.length > 2 ? 34 : 40;
  const T = (x, y, s, txt, o = {}) => `<text x="${x}" y="${y}" font-family="${o.f || "Jost, Arial, sans-serif"}" font-size="${s}" fill="${o.fill || fg}" text-anchor="${o.anchor || 'middle'}" letter-spacing="${o.ls || 0}" font-weight="${o.w || 400}" opacity="${o.op || 1}">${esc(txt)}</text>`;
  const L = (x1, y1, x2, y2, op = .55) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${fg}" stroke-width="1" opacity="${op}"/>`;
  const top = 92, title = lines.map((l, i) => T(150, top + i * fs * 1.1, fs, l, { w: 800 })).join(''), yEnd = top + (lines.length - 1) * fs * 1.1;
  let art = '';
  if(motif === 'linha') art = `${L(150, 0, 150, 52)}${L(150, yEnd + 52, 150, 360)}${L(150, 300, 230, 300)}${L(230, 300, 230, 352)}<circle cx="230" cy="300" r="2.6" fill="${fg}"/><circle cx="230" cy="364" r="12" fill="${gold}"/>${L(40, 378, 260, 378, .35)}`;
  else if(motif === 'circulo') art = `<path d="M150 236a70 70 0 0 0 0 140Z" fill="${gold}"/><path d="M150 236a70 70 0 0 1 0 140" fill="none" stroke="${fg}" stroke-width="1.5" stroke-dasharray="4 5"/>`;
  else if(motif === 'arco') art = [0, 1, 2, 3, 4].map(i => { const r = 34 + i * 22; return `<path d="M${150 - r} 372a${r} ${r} 0 0 1 ${2 * r} 0" fill="none" stroke="${i ? fg : gold}" stroke-width="${i ? 1.2 : 3}" opacity="${1 - i * .15}"/>`; }).join('') + `<circle cx="150" cy="372" r="16" fill="${gold}"/>${L(30, 372, 270, 372, .6)}`;
  else if(motif === 'numero') art = `<defs><pattern id="${u}p" width="16" height="12" patternUnits="userSpaceOnUse"><rect width="16" height="12" fill="${fg}" opacity=".18"/><path d="M0 11L8 3L16 11" stroke="${gold}" stroke-width="3.2" fill="none"/></pattern></defs><text x="290" y="384" text-anchor="end" font-family="'Cormorant Garamond', Georgia, serif" font-weight="700" font-size="240" fill="url(#${u}p)">${b.n || 1}</text>`;
  const sym = ['M50 84 C42 66 28 50 8 42 C30 42 48 58 50 84 Z', 'M50 84 C58 66 72 50 92 42 C70 42 52 58 50 84 Z', 'M50 84 C46 60 34 38 14 20 C36 26 52 48 50 84 Z', 'M50 84 C54 60 66 38 86 20 C64 26 48 48 50 84 Z'];
  return `<svg viewBox="0 0 300 450" role="img" aria-label="Capa: ${esc(b.short || '')}"><defs><filter id="${u}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .22 0 0 0 0"/></filter></defs>
    <rect width="300" height="450" fill="${bg}"/>${art}${title}
    ${T(150, 402, 8.5, String(b.author || '').toUpperCase(), { ls: 3.2, w: 600, op: .9 })}
    <g fill="${fg}" font-family="Jost, Arial, sans-serif" font-size="7.5" letter-spacing="2.5" font-weight="600"><text x="137" y="431" text-anchor="end">VELAH</text><text x="164" y="431">BOOKS</text></g>
    <g transform="translate(140 415.2) scale(.2)">${sym.map((d, k) => `<path d="${d}" fill="${k < 2 ? gold : fg}"/>`).join('')}</g>
    <rect width="300" height="450" filter="url(#${u}n)" opacity=".55"/></svg>`;
}

/* ---------- livros-semente (oferta de lançamento) e livro impresso ---------- */
const isFree = b => !!b && b.price === 0;
async function claimFree(slug, after){
  if(!USER){ loginModal('Cria a tua conta e lê grátis', () => claimFree(slug, after)); return; }
  const { error } = await sb.rpc('claim_free_book', { p_slug: slug });
  if(error){ toast(pgErr(error)); return; }
  await pullUser(); resetContent(); buzz([10, 40, 10]); renderAcct();
  toast('Está na tua biblioteca · oferta de lançamento');
  if(after){ after(); return; }
  if(!R.el.hidden && R.slug === slug){ R.book = await getBook(slug); renderChapter(0); return; }
  location.hash = 'ler-' + slug;
}
async function claimAllFree(){
  if(!USER){ loginModal('Cria a tua conta e recebe os livros', claimAllFree); return; }
  const free = BOOKS.filter(b => isFree(b) && !owns(b.slug));
  for(const b of free){ await sb.rpc('claim_free_book', { p_slug: b.slug }); }
  await pullUser(); resetContent(); renderAcct();
  toast(free.length ? `${free.length} ${free.length === 1 ? 'livro guardado' : 'livros guardados'} na tua biblioteca` : 'Já tens todos na biblioteca');
  burst(innerWidth / 2, innerHeight / 3); location.hash = 'biblioteca';
}
function launchOfferHTML(){
  const free = BOOKS.filter(isFree); if(!free.length) return '';
  const all = USER && free.every(b => owns(b.slug));
  return `<section class="sec offer"><div class="offer-in"><div>
    <div class="eyebrow">Oferta de lançamento</div>
    <h2>Os livros de Gerson Fidalgo são grátis na Velah</h2>
    <p>Cria a tua conta, guarda ${free.length === 1 ? 'o livro' : `os ${free.length} livros`} na tua biblioteca e começa a ler esta noite. Quando quiseres o livro completo em papel, está a um toque.</p>
    <div class="row">${all ? '<a class="btn primary" href="#biblioteca">Ir para a minha biblioteca</a>' : `<button class="btn primary" data-claimall>${USER ? 'Guardar todos na biblioteca' : 'Criar conta e receber os livros'}</button>`}</div></div>
    <div class="fan offer-fan">${free.slice(0, 3).map(b => coverEl(b.slug)).join('')}</div></div></section>`;
}
function printCTA(slug, place, big){
  const b = bySlug(slug); if(!b || !isFree(b) && !b.printUrl) return '';
  const asked = !!(S.printAsk || {})[slug];
  const price = b.printPrice ? ' · ' + eur(b.printPrice / 100) : '';
  const btn = b.printUrl
    ? `<a class="btn primary small" href="${esc(b.printUrl)}" target="_blank" rel="noopener" data-print="${slug}" data-place="${esc(place)}">${esc(b.printLabel || 'Comprar o livro impresso')}${price}</a>`
    : `<button class="btn ${asked ? 'ghost' : 'primary'} small" data-printask="${slug}" data-place="${esc(place)}" ${asked ? 'disabled' : ''}>${asked ? 'Pedido registado ✓' : 'Quero o livro impresso'}</button>`;
  const head = big ? 'O livro continua em papel' : 'Continua no livro completo';
  const txt = (b.edition ? esc(b.edition) + '. ' : '') + (b.printUrl ? 'A edição completa, em papel, com tudo o que esta versão não traz.' : 'Diz-nos que o queres e avisamos-te assim que estiver disponível.');
  return `<div class="printcta${big ? ' big' : ''}">${symSVG(30, 24, 'var(--wick)', 'currentColor')}<div><b>${head}</b><span>${txt}</span></div>${btn}</div>`;
}
document.addEventListener('click', async e => {
  if(e.target.closest('[data-claimall]')){ e.preventDefault(); claimAllFree(); return; }
  const a = e.target.closest('[data-printask]');
  if(a){
    e.preventDefault(); const slug = a.dataset.printask;
    if(!USER){ loginModal('Entra para pedires o livro impresso', () => route()); return; }
    const { error } = await sb.from('print_leads').insert({ book_id: bookId(slug), user_id: USER.id, kind: 'interest', place: (a.dataset.place || '').slice(0, 40) });
    if(error){ toast('Não foi possível registar. Tenta outra vez.'); return; }
    S.printAsk = Object.assign({}, S.printAsk, { [slug]: Date.now() }); save();
    document.querySelectorAll(`[data-printask="${slug}"]`).forEach(x => { x.textContent = 'Pedido registado ✓'; x.disabled = true; x.classList.replace('primary', 'ghost'); });
    burstAt(a); buzz(10); toast('Avisamos-te quando o livro impresso estiver disponível'); return;
  }
  const c = e.target.closest('[data-print]');
  if(c) sb.from('print_leads').insert({ book_id: bookId(c.dataset.print), user_id: USER?.id || null, kind: 'click', place: (c.dataset.place || '').slice(0, 40) }).then(() => {});
});
