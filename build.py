"""Gera velah-app/index.html a partir do protótipo (candeia/site/index.html) + src/*.js|css."""
import re, pathlib
ROOT = pathlib.Path('/home/claude/velah-app')
s = pathlib.Path('/home/claude/candeia/site/index.html').read_text(encoding='utf-8')
backend = (ROOT/'src/backend.js').read_text(encoding='utf-8')
admin = (ROOT/'src/admin.js').read_text(encoding='utf-8')
css = (ROOT/'src/app.css').read_text(encoding='utf-8')
def rep(a, b, n=1):
    global s
    c = s.count(a); assert c == n, (a[:90], c); s = s.replace(a, b)

rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<script src="vendor/marked.min.js"></script>\n<script src="vendor/supabase.js"></script>\n<script src="config.js"></script>')
rep('@media (prefers-reduced-motion:reduce)', css + '\n@media (prefers-reduced-motion:reduce)')
a = s.index('const BOOKS = ['); b = s.index('const bySlug')
s = s[:a] + "const BOOKS = [];\nlet BUNDLE = null;\nlet LAUNCH = '';\nconst UPCOMING = [];\n" + s[b:]
rep("const KEY='candeia.v1';", "const KEY='velah.v1';")
# capas
rep("function cover(slug){\n  const u = 'c'+(++uid);", "function cover(slug){\n  const _b = bySlug(slug) || BOOK_ROWS.find(r=>r.slug===slug);\n  const _g = () => genericCover(_b ? {..._b, author:_b.author||(_b.authors&&_b.authors.name)||'', n:_b.n||_b.series_n} : {slug, short:slug});\n  if(_b && _b.cover && _b.cover.url) return _g();\n  const u = 'c'+(++uid);")
rep("  if(b && b.n){", "  if(b && b.n && /^mil[123]$/.test(slug)){")
rep("  return svg('Capa provisória', '#1c2130', '', `${T(150,220,22,'EM BREVE',{ls:4})}${mark(cream)}`);", "  return _g();")
# avisos
a = s.index("  const n = e.target.closest('[data-notify]'); if(n){"); b = s.index('\n', a)
s = s[:a] + "  const n = e.target.closest('[data-notify]'); if(n){ toggleNotify(n); }" + s[b:]
# loja
rep("  const series = BOOKS.filter(b=>b.series);\n  const f = bySlug('expulso');",
    "  const series = BOOKS.filter(b=>b.status==='presale');\n  const f = BOOKS.find(b=>b.featured && b.status==='ready') || ready[0] || BOOKS[0];\n  if(!f){ view.innerHTML = '<div class=\"empty\"><h2>A loja abre em breve</h2></div>'; return; }")
rep('<a class="btn primary" href="#livro-expulso">Ver o livro em destaque</a>', '<a class="btn primary" href="#livro-${f.slug}">Ver o livro em destaque</a>')
rep('<a class="btn ghost" href="#ler-expulso">Ler a amostra grátis</a>', '<a class="btn ghost" href="#ler-${f.slug}">Ler a amostra grátis</a>')
rep('<a class="hero-cover" href="#livro-expulso" aria-label="${esc(f.title)}">${coverEl(\'expulso\')}<span class="tag">Novo</span></a>',
    '<a class="hero-cover" href="#livro-${f.slug}" aria-label="${esc(f.title)}">${coverEl(f.slug)}${f.badge?`<span class="tag">${esc(f.badge)}</span>`:\'\'}</a>')
a = s.index('  <section class="sec">\n    <div class="sec-head"><div><div class="eyebrow">Acesso antecipado')
b = s.index('  <section class="sec">\n    <div class="sec-head"><div><div class="eyebrow">Em preparação</div>')
s = s[:a] + '''  ${series.length?`<section class="sec">
    <div class="sec-head"><div><div class="eyebrow">Acesso antecipado${LAUNCH?' · lançamento a '+LAUNCH:''}</div><h2>${esc(series[0].seriesName||'Pré-venda')}</h2></div><p>Reserva agora e lê já a introdução e o primeiro capítulo de cada livro. O resto abre na tua biblioteca no dia do lançamento.</p></div>
    <div class="shelf">${series.map(card).join('')}</div>
    ${BUNDLE?`<div class="bundle">
      <div class="fan">${BUNDLE.books.map(s=>coverEl(s)).join('')}</div>
      <div><h3>${esc(BUNDLE.title)}</h3><p>${BUNDLE.books.length} livros por um preço, numa só compra.</p></div>
      <div class="row">${BUNDLE.books.every(s=>owns(s))?'<span class="chip ok">Na biblioteca</span>':`<span class="price"><span class="strike">${eur(BUNDLE.books.reduce((a,s)=>a+(bySlug(s)?.price||0),0))}</span>${eur(BUNDLE.price)}</span><button class="btn primary" data-buy="${BUNDLE.slug}">Reservar a série</button>`}</div>
    </div>`:''}
  </section>`:''}

''' + s[b:]
rep('''  <section class="sec">
    <div class="sec-head"><div><div class="eyebrow">Em preparação</div><h2>Em breve na Velah</h2></div></div>''',
'''  ${UPCOMING.length?`<section class="sec">
    <div class="sec-head"><div><div class="eyebrow">Em preparação</div><h2>Em breve na Velah</h2></div></div>''')
a = s.index('<div class="soon">${UPCOMING.map(')
b = s.index('</section>', a)
s = s[:b] + '</section>`:\'\'}' + s[b+len('</section>'):]
rep("b.series.replace('Série Milionário · ','')", "b.series.replace(/^.* · /,'')")
rep('<span class="chip">Edição impressa: ${b.pages} pp. A5</span>', "${b.pages?`<span class=\"chip\">Edição impressa: ${b.pages} pp.</span>`:''}")
rep("'Comprado nesta demonstração.'", "'Guardado na tua conta Velah.'")
rep('<span class="demo-pill">Protótipo · pagamentos simulados</span>', '<span class="demo-pill">Beta</span>')
rep('<span>Protótipo de 18/10/2026. Nenhum pagamento real é feito.</span>', '<span><a href="#termos">Termos</a> · <a href="#privacidade">Privacidade</a> · <a href="https://www.livroreclamacoes.pt" target="_blank" rel="noopener">Livro de Reclamações</a></span>')
# biblioteca: cartão de entrada
rep("    ${cont}\n    ${ritualHTML()}", "    ${USER?'':loginCard('Entra para guardares a biblioteca, o caderno e o ritual em todos os teus dispositivos.')}\n    ${cont}\n    ${ritualHTML()}")
# a primeira renderAcct() corria antes de existir sessão
rep("renderAcct();\n\nfunction vGate(){", "\nfunction vGate(){")
# arranque
a = s.rindex('route();\n</script>')
s = s[:a] + backend + '\n' + admin + '\nboot();\n</script>' + s[a+len('route();\n</script>'):]
(ROOT/'index.html').write_text(s, encoding='utf-8')
print('index.html', len(s)//1024, 'KB')
