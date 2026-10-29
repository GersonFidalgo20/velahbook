/* ================= Velah · administração (só papel admin) ================= */
// Manuscrito .md → capítulos (o mesmo formato dos manuscritos do projeto RSET).
function mdTransform(md){
  md = md.replace(/:::box\n([\s\S]*?)\n:::/g, (_, a) => '<div class="box">\n\n' + a.trim() + '\n\n</div>');
  md = md.replace(/\[\[QR:\s*(.+?)\]\]/g, (_, a) => `<div class="qr"><span>${a.trim()}</span><em>Disponível no lançamento</em></div>`);
  md = md.split('\\line').join('<div class="fill-line"></div>').split('\\sign').join('<span class="sign-line"></span>');
  md = md.replace(/^\*Rascunho[^\n]*\*\s*$/gm, '');
  md = md.trim().replace(/(\n\s*---\s*)+\s*$/, '').replace(/^\s*---\s*\n/, '').replace(/\n{3,}/g, '\n\n');
  return md.trim();
}
const wordsOf = md => (String(md).replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}_]+/gu) || []).length;
function parseManuscript(text){
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const lvl = lines.some(l => /^## /.test(l)) ? 2 : 1;
  let title = '', part = null, cur = null; const pre = [], chs = [];
  for(const ln of lines){
    const m = ln.match(/^(#{1,2}) (.+?)\s*$/);
    if(m && m[1].length <= lvl){
      const lv = m[1].length, t = m[2].trim();
      if(lv < lvl){ if(!title){ title = t; continue; } if(t === title) continue; if(cur){ chs.push(cur); cur = null; } part = t; continue; }
      if(cur) chs.push(cur); else if(wordsOf(pre.join('\n')) > 60) chs.push({ t: 'Abertura', part: null, lines: pre.slice() });
      cur = { t, part, lines: [] }; continue;
    }
    (cur ? cur.lines : pre).push(ln);
  }
  if(cur) chs.push(cur);
  if(lvl === 1 && chs.length > 1 && wordsOf(chs[0].lines.join('\n')) < 15){ title = title || chs[0].t; chs.shift(); }
  const out = chs.map(c => { const md = mdTransform(c.lines.join('\n')); return { title: c.t.replace(/^Livro [IVX]+ — /, ''), part: c.part, md, words: wordsOf(md) }; })
    .filter(c => !(c.md.includes('[A COMPLETAR') && c.words < 80));
  const first = out.findIndex(c => /cap[íi]tulo\s*(1|i|um)\b/i.test(c.title));
  const upTo = first >= 0 ? first : Math.min(1, out.length - 1);
  out.forEach((c, i) => { c.idx = i; c.free = i <= upTo; c.soon = !c.md; });
  return { title, chapters: out };
}
const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'livro';

let ADM = { tab: 'livros', parsed: null, edit: null };
const ADM_TABS = [['geral', 'Visão geral'], ['livros', 'Livros'], ['importar', 'Importar manuscrito'], ['acessos', 'Acessos e papéis'], ['codigos', 'Códigos do impresso'], ['prendas', 'Prendas'], ['candidaturas', 'Candidaturas']];
async function vAdmin(tab){
  ADM.tab = tab || ADM.tab;
  view.innerHTML = `<div class="dash-head"><div><div class="eyebrow">Administração · RSET Publisher</div><h1>Velah Books</h1></div><a class="btn ghost" href="#loja">Ver a loja</a></div>
    <nav class="admtabs" aria-label="Secções">${ADM_TABS.map(([k, l]) => `<a href="#admin/${k}" aria-current="${k === ADM.tab ? 'page' : 'false'}">${l}</a>`).join('')}</nav>
    <div id="adm" class="adm"></div>`;
  const el = document.getElementById('adm');
  try{ await ({ geral: admGeral, livros: admLivros, importar: admImport, acessos: admAcessos, codigos: admCodigos, prendas: admPrendas, candidaturas: admCand }[ADM.tab] || admLivros)(el); }
  catch(e){ el.innerHTML = `<div class="empty"><h2>Erro</h2><p>${esc(pgErr(e))}</p></div>`; }
}
const bookOpts = (sel, filter) => BOOK_ROWS.filter(filter || (() => true)).map(b => `<option value="${b.slug}" ${b.slug === sel ? 'selected' : ''}>${esc(b.short)} · ${b.status}</option>`).join('');
const STATUS_L = { draft: 'Rascunho', soon: 'Em breve', presale: 'Pré-venda', ready: 'À venda' };

async function admGeral(el){
  const { data, error } = await sb.rpc('admin_overview'); if(error) throw error;
  const k = (l, v, s) => `<div class="kpi"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  el.innerHTML = `<div class="kpis">${k('Contas', int(data.users))}${k('Leitores ativos (7 dias)', int(data.readers_7d))}${k('Encomendas pagas', int(data.orders_paid), eur(data.revenue_cents / 100) + ' de receita')}${k('Candidaturas de autores', int(data.applications))}</div>
    <div class="kpis" style="margin-top:14px">${k('Livros no catálogo', BOOK_ROWS.length, BOOK_ROWS.filter(b => b.status === 'ready').length + ' à venda')}${k('Códigos do impresso', int(data.print_codes), int(data.print_redeemed) + ' usados')}</div>`;
}

async function admLivros(el){
  const { data, error } = await sb.from('books').select('*, authors(name)').order('sort'); if(error) throw error;
  BOOK_ROWS = data.map(b => ({ ...b, authors: b.authors }));
  el.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:14px"><p style="margin:0;color:var(--dim)">${data.length} livros. Os rascunhos só são visíveis para a administração.</p><a class="btn primary" href="#admin/importar">+ Novo livro a partir do manuscrito</a></div>
    <div class="tablewrap"><table class="admtable"><thead><tr><th>Livro</th><th>Estado</th><th>Preço</th><th>Capítulos</th><th>Palavras</th><th></th></tr></thead><tbody>
    ${data.map(b => `<tr><td class="book">${coverEl(b.slug)}<span><b>${esc(b.short)}</b><br><small style="color:var(--dim)">${esc(b.authors?.name || '')} · ${b.slug}</small></span></td>
      <td><span class="chip ${b.status === 'ready' ? 'ok' : b.status === 'presale' ? 'gold' : ''}">${STATUS_L[b.status]}</span></td><td>${eur(b.price_cents / 100)}</td><td>${b.toc.length}</td><td>${int(b.words)}</td>
      <td><button class="btn ghost small" data-edit="${b.slug}">Editar</button></td></tr>`).join('')}</tbody></table></div><div id="admedit"></div>`;
  el.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => { const b = data.find(x => x.slug === btn.dataset.edit); bookForm(document.getElementById('admedit'), b, null); document.getElementById('admedit').scrollIntoView({ behavior: 'smooth' }); });
}

function bookForm(el, b, parsed){
  b = b || {}; const c = b.cover || {};
  const f = (id, label, val, attrs = '') => `<div class="field"><label for="bf-${id}">${label}</label><input id="bf-${id}" value="${esc(val ?? '')}" ${attrs}></div>`;
  el.innerHTML = `<form class="bookform panelbox" id="bform"><h3>${b.id ? 'Editar · ' + esc(b.short) : 'Dados do livro'}</h3>
    <div class="grid2">
      ${f('title', 'Título completo', b.title, 'required')}${f('short', 'Título curto (loja)', b.short)}
      ${f('sub', 'Subtítulo', b.sub)}${f('author', 'Autor', b.authors?.name || b.author || 'Gerson Fidalgo', 'required')}
      ${f('slug', 'Identificador (só letras e números)', b.slug || (b.title ? slugify(b.title) : ''), b.id ? 'readonly' : 'required pattern="[a-z0-9]+"')}
      ${f('price', 'Preço (€, IVA incluído)', b.price_cents != null ? (b.price_cents / 100).toFixed(2) : '7.90', 'inputmode="decimal" required')}
      <div class="field"><label for="bf-status">Estado</label><select id="bf-status">${Object.entries(STATUS_L).map(([k, l]) => `<option value="${k}" ${k === (b.status || 'draft') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${f('badge', 'Etiqueta (ex.: Novo)', b.badge)}
      ${f('launch_label', 'Data de lançamento (texto)', b.launch_label, 'placeholder="22 de janeiro de 2027"')}${f('launch_date', 'Data de lançamento', b.launch_date, 'type="date"')}
      ${f('event_label', 'Evento de lançamento', b.event_label)}${f('pages', 'Páginas (impresso)', b.pages, 'inputmode="numeric"')}
      ${f('series', 'Série', b.series)}${f('series_n', 'Número na série', b.series_n, 'inputmode="numeric"')}
      ${f('sort', 'Ordem na loja', b.sort ?? 100, 'inputmode="numeric"')}
      <div class="field"><label><input type="checkbox" id="bf-featured" ${b.featured ? 'checked' : ''}> Destaque na página inicial</label></div>
    </div>
    <div class="field"><label for="bf-blurb">Descrição</label><textarea id="bf-blurb" rows="4">${esc(b.blurb || '')}</textarea></div>
    ${f('pull', 'Frase de destaque', b.pull)}
    <h3 style="margin-top:8px">Capa</h3>
    <div class="grid2">${f('cover_url', 'Imagem da capa (URL, opcional)', c.url, 'placeholder="https://…/capa.jpg"')}
      <div class="field"><label for="bf-bg">Cor da Coleção Velah</label><input id="bf-bg" type="color" value="${c.bg || '#15262B'}"></div>
      <div class="field"><label for="bf-motif">Desenho</label><select id="bf-motif">${[['', 'Automático'], ['linha', 'Linha'], ['circulo', 'Círculo'], ['arco', 'Nascer do sol'], ['numero', 'Número da série']].map(([k, l]) => `<option value="${k}" ${k === (c.motif || '') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Pré-visualização</label><div class="cprev" id="cprev"></div></div></div>
    ${parsed ? `<p class="hint">Vai gravar ${parsed.chapters.length} capítulos (${int(parsed.chapters.reduce((a, c) => a + c.words, 0))} palavras).</p>` : ''}
    <div class="row"><button class="btn primary">${parsed ? 'Publicar livro e capítulos' : 'Guardar alterações'}</button><span class="hint" id="bf-msg"></span></div></form>`;
  const form = el.querySelector('#bform'), v = id => form.querySelector('#bf-' + id).value.trim();
  const prev = () => { const tmp = { slug: v('slug') || 'novo', short: v('short') || v('title') || 'Título', author: v('author'), n: +v('series_n') || null, cover: { url: v('cover_url'), bg: v('bg'), motif: v('motif') } };
    form.querySelector('#cprev').innerHTML = `<span class="cover">${genericCover(tmp)}</span>`; };
  if(!b.id) form.querySelector('#bf-title').addEventListener('input', () => { const s = form.querySelector('#bf-slug'); if(!s.dataset.touched) s.value = slugify(v('title')); prev(); });
  form.querySelector('#bf-slug').addEventListener('input', e => e.target.dataset.touched = 1);
  form.addEventListener('input', prev); prev();
  form.onsubmit = async e => {
    e.preventDefault();
    const price = Math.round(parseFloat(v('price').replace(',', '.')) * 100);
    if(!(price >= 0)){ toast('Preço inválido'); return; }
    const book = { slug: v('slug'), title: v('title'), short: v('short') || v('title'), sub: v('sub'), author: v('author'), price_cents: price, status: v('status'),
      badge: v('badge'), launch_label: v('launch_label'), launch_date: v('launch_date'), event_label: v('event_label'), pages: v('pages'), series: v('series'), series_n: v('series_n'),
      sort: +v('sort') || 100, featured: form.querySelector('#bf-featured').checked, blurb: form.querySelector('#bf-blurb').value.trim(), pull: v('pull'),
      cover: Object.fromEntries(Object.entries({ url: v('cover_url'), bg: v('bg'), motif: v('motif'), preset: (b.cover || {}).preset }).filter(([, x]) => x)) };
    const p = { book };
    if(parsed){ p.chapters = parsed.chapters.map(c => ({ idx: c.idx, title: c.title, part: c.part || '', md: c.md, free: c.free, words: c.words }));
      p.toc = parsed.chapters.map(c => ({ t: c.title, part: c.part || null, free: c.free, w: c.words, soon: c.soon })); p.words = parsed.chapters.reduce((a, c) => a + c.words, 0); }
    const btn = form.querySelector('button.primary'); btn.disabled = true; form.querySelector('#bf-msg').textContent = 'A gravar…';
    const { error } = await sb.rpc('admin_import_book', { p });
    btn.disabled = false;
    if(error){ form.querySelector('#bf-msg').textContent = pgErr(error); return; }
    INDEX = null; resetContent(); await loadCatalog(); toast('Livro guardado'); ADM.parsed = null;
    if(parsed) burst(innerWidth / 2, innerHeight / 3);
    location.hash = 'admin/livros'; if(ADM.tab === 'livros') vAdmin('livros');
  };
}

async function admImport(el){
  el.innerHTML = `<div class="panelbox"><h3>1 · Manuscrito</h3><p class="hint">Carrega o ficheiro .md do manuscrito final (o mesmo formato dos livros do projeto RSET), ou cola o texto. Títulos com <code>#</code> são partes e <code>##</code> são capítulos. Os exercícios <code>\\line</code>, <code>\\sign</code>, <code>:::box</code> e <code>[[QR: …]]</code> são reconhecidos.</p>
    <div class="row"><input type="file" id="mf" accept=".md,.markdown,.txt,text/markdown,text/plain"><span class="hint">ou</span></div>
    <textarea id="mt" rows="8" placeholder="# Título do livro&#10;&#10;## Introdução&#10;…" style="width:100%;margin-top:10px"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="mp">Analisar capítulos</button>
      <label class="hint">Substituir o conteúdo de: <select id="mx"><option value="">— livro novo —</option>${bookOpts('')}</select></label></div></div>
    <div id="mprev"></div><div id="mform"></div>`;
  const mt = el.querySelector('#mt');
  el.querySelector('#mf').onchange = async e => { const file = e.target.files[0]; if(file){ mt.value = await file.text(); toast(file.name + ' carregado'); } };
  el.querySelector('#mp').onclick = () => {
    if(!mt.value.trim()){ toast('Carrega ou cola o manuscrito'); return; }
    const parsed = ADM.parsed = parseManuscript(mt.value);
    const existing = BOOK_ROWS.find(b => b.slug === el.querySelector('#mx').value);
    let lastPart = null;
    el.querySelector('#mprev').innerHTML = `<div class="panelbox" style="margin-top:14px"><h3>2 · Capítulos encontrados (${parsed.chapters.length})</h3><p class="hint">Marca os capítulos grátis da amostra. Capítulos vazios ficam como "em breve".</p>
      <ul class="toc">${parsed.chapters.map(c => { let h = ''; if(c.part && c.part !== lastPart) h = `<li class="part">${esc(c.part)}</li>`; lastPart = c.part;
        return h + `<li><div class="r"><span class="t">${esc(c.title)}</span><span class="m">${c.soon ? '<span class="chip">em breve</span>' : int(c.words) + ' palavras'}<label class="chip"><input type="checkbox" data-free="${c.idx}" ${c.free ? 'checked' : ''}> grátis</label><button class="btn ghost small" data-peek="${c.idx}">Ver</button></span></div></li>`; }).join('')}</ul>
      <div id="peek"></div></div>`;
    el.querySelectorAll('[data-free]').forEach(cb => cb.onchange = () => { parsed.chapters[+cb.dataset.free].free = cb.checked; });
    el.querySelectorAll('[data-peek]').forEach(bt => bt.onclick = () => { const c = parsed.chapters[+bt.dataset.peek]; el.querySelector('#peek').innerHTML = `<div class="peek"><h4>${esc(c.title)}</h4>${marked.parse(c.md.slice(0, 4000))}${c.md.length > 4000 ? '<p>…</p>' : ''}</div>`; });
    bookForm(el.querySelector('#mform'), existing || { title: parsed.title, short: parsed.title, author: 'Gerson Fidalgo', status: 'draft' }, parsed);
    el.querySelector('#mform').scrollIntoView({ behavior: 'smooth' });
  };
}

async function admAcessos(el){
  el.innerHTML = `<div class="two" style="margin-top:0">
    <form class="panelbox" id="ga"><h3>Dar acesso a um livro</h3><p class="hint">Para convidados, imprensa ou beta-leitores. A pessoa tem de ter entrado na Velah pelo menos uma vez.</p>
      <div class="field"><label for="ga-e">Email</label><input id="ga-e" type="email" required></div>
      <div class="field"><label for="ga-b">Livro</label><select id="ga-b">${bookOpts('', b => ['ready', 'presale'].includes(b.status))}</select></div>
      <button class="btn primary">Dar acesso</button></form>
    <form class="panelbox" id="gr"><h3>Papel de uma conta</h3><p class="hint">Autor: vê o painel com as vendas dos seus livros. Administração: acesso total.</p>
      <div class="field"><label for="gr-e">Email</label><input id="gr-e" type="email" required></div>
      <div class="field"><label for="gr-r">Papel</label><select id="gr-r"><option value="reader">Leitor</option><option value="author">Autor</option><option value="admin">Administração</option></select></div>
      <div class="field"><label for="gr-a">Nome de autor (como aparece nos livros)</label><input id="gr-a" placeholder="Ex.: Gerson Fidalgo"></div>
      <button class="btn primary">Guardar papel</button></form></div>`;
  el.querySelector('#ga').onsubmit = async e => { e.preventDefault(); const { error } = await sb.rpc('admin_grant', { p_email: el.querySelector('#ga-e').value, p_slug: el.querySelector('#ga-b').value }); toast(error ? pgErr(error) : 'Acesso dado'); };
  el.querySelector('#gr').onsubmit = async e => { e.preventDefault(); const { error } = await sb.rpc('admin_set_role', { p_email: el.querySelector('#gr-e').value, p_role: el.querySelector('#gr-r').value, p_author: el.querySelector('#gr-a').value || null }); toast(error ? pgErr(error) : 'Papel atualizado'); };
}

async function admCodigos(el){
  el.innerHTML = `<form class="panelbox" id="pc"><h3>Códigos para a contracapa</h3><p class="hint">Cada exemplar impresso leva um código único. Quem o escreve na Velah (ou lê o QR) fica com o livro digital na conta. Cada código só serve uma vez.</p>
    <div class="grid2"><div class="field"><label for="pc-b">Livro</label><select id="pc-b">${bookOpts('', b => b.status === 'ready')}</select></div>
    <div class="field"><label for="pc-n">Quantidade</label><input id="pc-n" type="number" min="1" max="5000" value="100"></div>
    <div class="field"><label for="pc-l">Lote (ex.: 1.ª tiragem)</label><input id="pc-l" placeholder="Tiragem dez 2026"></div></div>
    <button class="btn primary">Gerar códigos</button></form><div id="pcout"></div>`;
  el.querySelector('#pc').onsubmit = async e => {
    e.preventDefault(); const slug = el.querySelector('#pc-b').value;
    const { data, error } = await sb.rpc('admin_create_print_codes', { p_slug: slug, p_n: +el.querySelector('#pc-n').value, p_batch: el.querySelector('#pc-l').value });
    if(error){ toast(pgErr(error)); return; }
    const rows = data.map(c => `${c},${appBase()}#qr-${slug}/${c}`);
    el.querySelector('#pcout').innerHTML = `<div class="panelbox" style="margin-top:14px"><h3>${data.length} códigos gerados</h3><p class="hint">Envia o ficheiro à gráfica: cada linha tem o código e o link para o QR.</p>
      <textarea readonly rows="8" style="width:100%">${rows.join('\n')}</textarea><div class="row" style="margin-top:10px"><button class="btn primary" id="pcdl">Descarregar CSV</button></div></div>`;
    el.querySelector('#pcdl').onclick = () => saveFile(`codigos-${slug}.csv`, new Blob(['codigo,link\n' + rows.join('\n')], { type: 'text/csv' }));
  };
}

async function admPrendas(el){
  el.innerHTML = `<form class="panelbox" id="pg"><h3>Prenda promocional</h3><p class="hint">Um link que oferece um livro a uma pessoa (sorteios, parceiros, imprensa). Cada link abre uma vez.</p>
    <div class="grid2"><div class="field"><label for="pg-b">Livro</label><select id="pg-b">${bookOpts('', b => ['ready', 'presale'].includes(b.status))}</select></div>
    <div class="field"><label for="pg-f">De</label><input id="pg-f" value="Velah Books"></div><div class="field"><label for="pg-t">Para</label><input id="pg-t"></div></div>
    <div class="field"><label for="pg-m">Mensagem</label><textarea id="pg-m" rows="2" maxlength="160"></textarea></div><button class="btn primary">Criar link</button></form><div id="pgout"></div>`;
  el.querySelector('#pg').onsubmit = async e => {
    e.preventDefault(); const slug = el.querySelector('#pg-b').value;
    const { data, error } = await sb.rpc('admin_promo_gift', { p_slug: slug, p_from: el.querySelector('#pg-f').value, p_to: el.querySelector('#pg-t').value, p_message: el.querySelector('#pg-m').value });
    if(error){ toast(pgErr(error)); return; }
    el.querySelector('#pgout').innerHTML = `<div class="panelbox" style="margin-top:14px">${giftDoneHTML({ code: data, to: el.querySelector('#pg-t').value, slug, title: bySlug(slug)?.short })}</div>`;
  };
}

async function admCand(el){
  const { data, error } = await sb.from('author_applications').select('*').order('created_at', { ascending: false }).limit(200); if(error) throw error;
  el.innerHTML = data.length ? data.map(a => `<article class="nb-item ans"><div class="nb-ch">${new Date(a.created_at).toLocaleString('pt-PT')}</div><p class="nb-a"><b>${esc(a.name)}</b> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p><p class="nb-q">${esc(a.message || '—')}</p></article>`).join('')
    : `<div class="empty"><h2>Ainda sem candidaturas</h2><p>Aparecem aqui as pessoas que carregam em "Quero publicar na Velah".</p></div>`;
}
