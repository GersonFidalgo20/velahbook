# Velah Books · app real (beta)

Loja, biblioteca e leitor noturno da RSET Publisher, ligados a uma base de dados real (Supabase) e prontos para pagamentos Stripe.

## O que já está a funcionar

- **Contas sem palavra-passe:** o leitor recebe um link e um código por email. O mesmo login serve para leitor, autor e administração.
- **Livros protegidos:** um visitante só recebe os capítulos grátis. O resto só chega a quem comprou, e a proteção é feita no servidor.
- **Sincronização:** biblioteca, ponto de leitura, sublinhados, notas, respostas aos exercícios, reações e noites de leitura ficam guardados na conta. Abrem iguais no telemóvel e no computador.
- **Compra:** o pagamento passa pelo Stripe (MB WAY, cartão, Apple Pay, Google Pay). O livro entra na biblioteca automaticamente quando o pagamento é confirmado.
- **Prendas:** quem compra para outra pessoa recebe um link. Quem o abre desembrulha o livro e guarda-o na sua conta.
- **Livro impresso:** cada exemplar leva um código único na contracapa (com QR), que desbloqueia o digital uma só vez.
- **Painel do autor:** vendas, receita, royalties (80% do líquido), leitores com contacto e até onde leem.
- **Administração** (menu da conta → Administração):
  - importar manuscritos .md;
  - editar livros, preços, estados e capas;
  - dar acesso a livros e atribuir papéis (autor, administração);
  - gerar códigos para a gráfica e prendas promocionais;
  - ver as candidaturas de autores.

O email **fidalgogerson@gmail.com** fica administrador automaticamente no primeiro login.

## Publicar em velahbooks.com (cerca de 15 minutos)

1. **Alojamento.** A forma mais simples é o Netlify Drop:
   - entra em app.netlify.com/drop;
   - arrasta para lá esta pasta inteira (`velah-app`);
   - fica online num endereço `….netlify.app`.

   O Vercel também serve: importa a pasta como projeto estático.
2. **Domínio.** No Netlify: *Domain management → Add domain → velahbooks.com*. Depois, no sítio onde compraste o domínio, aponta o DNS como o Netlify indicar. O HTTPS é automático.
3. **Supabase → Authentication → URL Configuration:**
   - **Site URL:** `https://velahbooks.com`
   - **Redirect URLs:** `https://velahbooks.com/**` e o endereço `….netlify.app/**`
4. **Supabase → Authentication → Email Templates → Magic Link:**
   - **Assunto:** "A tua entrada na Velah Books".
   - **Corpo:** cola o conteúdo de `supabase/email/magic-link.html`. Inclui o código de 6 dígitos, que é útil quando a app está instalada no telemóvel.
5. **Envio de emails (obrigatório antes de abrir ao público).** O envio incluído no Supabase só aguenta alguns emails por hora.
   - Cria uma conta grátis na Resend (ou noutro serviço SMTP) com o domínio velahbooks.com.
   - Em *Supabase → Authentication → SMTP Settings*, coloca o remetente `ola@velahbooks.com`.

## Ativar pagamentos (quando a conta Stripe da empresa estiver aprovada)

1. **Métodos de pagamento.** No Stripe, em *Settings → Payment methods*, ativa MB WAY, cartões, Apple Pay, Google Pay e, se quiseres, Multibanco.
2. **Webhook.** No Stripe, em *Developers → Webhooks → Add endpoint*:
   - **URL:** `https://krbizbgxybunbvzxnwuo.supabase.co/functions/v1/stripe-webhook`
   - **Eventos:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
3. **Segredos.** No Supabase, em *Edge Functions → Secrets*, adiciona:
   - `STRIPE_SECRET_KEY` = a chave secreta do Stripe (`sk_live_…`; para testar, usa `sk_test_…`)
   - `STRIPE_WEBHOOK_SECRET` = o `whsec_…` do webhook do passo 2
   - `STRIPE_AUTOMATIC_TAX` = `true` (só se ativares o Stripe Tax)
4. **Faturação certificada.** Liga o software de faturação certificado (InvoiceXpress, Moloni ou Vendus) ao Stripe, para cada venda gerar a fatura.

Até estes passos estarem feitos, o botão de pagar mostra "Os pagamentos ainda não estão ativos nesta beta". Tudo o resto funciona.

## Oferta de lançamento e livro impresso

- **Livros grátis.** Um livro a 0 € aparece na loja como "Oferta de lançamento". O leitor cria conta e guarda-o na biblioteca com um toque. Os livros de Gerson Fidalgo já estão assim.
- **Livro impresso.** Cada livro grátis mostra "Quero o livro impresso" na página do livro, no fim de cada capítulo e, em destaque, no fim da edição.
  - **Sem link de compra:** o botão regista o pedido do leitor.
  - **Com link de compra:** leva o leitor à loja.
  - **Onde se configura:** em *Administração → Livros → Editar*, nos campos "Link de compra do livro impresso", "Preço do impresso" e "Nota de edição" (ex.: "Edição Velah · 30% do livro").
- **Onde ver os números:**
  - *Administração → Visão geral* e *Painel do autor* mostram contas novas, livros guardados, pedidos do impresso e cliques para comprar.

## Carregar os 30 livros

Menu da conta → **Administração → Importar manuscrito**:

1. Carrega o ficheiro .md, que pode ser o "manuscrito final" do projeto RSET.
2. Carrega em **Analisar capítulos**. Títulos `#` são partes e `##` são capítulos. Os exercícios `\line` e `\sign`, as caixas `:::box` e os `[[QR: …]]` passam a ser interativos no leitor.
3. Confirma os capítulos grátis. Por defeito ficam grátis tudo até ao "Capítulo 1", inclusive.
4. Preenche preço, estado, descrição e capa. A capa pode ser uma imagem por URL ou a capa automática da Coleção Velah, com cor e desenho à escolha.
5. Publica:
   - **Rascunho:** só a administração vê.
   - **Em breve:** aparece com "Avisar-me".
   - **Pré-venda:** reserva com amostra.
   - **À venda:** livro completo.

Para atualizar um livro já publicado, escolhe-o em "Substituir o conteúdo de". Os leitores mantêm a compra e o progresso.

## Antes do lançamento

- **Plano Supabase.** O projeto está no plano gratuito, que pausa após uma semana sem uso. Passa para o plano Pro (25 $/mês) antes de abrir ao público.
- **Limpeza.** Corre `supabase/cleanup.sql` no *SQL Editor* do Supabase. Remove a tabela temporária de carregamento e a conta de teste (já está bloqueada).
- **Textos legais.** Os termos e a política de privacidade da app são rascunhos e devem ser revistos por um jurista.

## Estrutura

| Pasta ou ficheiro | O que é |
|---|---|
| `index.html` | A app completa (gerada por `build.py` a partir do protótipo + `src/`) |
| `config.js` | Endereço e chave pública do Supabase (pode estar visível; a segurança está nas regras da base de dados) |
| `vendor/` | Bibliotecas (supabase-js 2.45.4, marked 12.0.2), servidas a partir do próprio site |
| `supabase/migrations/` | Esquema da base de dados, regras de acesso e funções |
| `supabase/functions/` | `create-checkout` e `stripe-webhook` (já publicadas no projeto `velah-books`) |
| `supabase/email/` | Modelo do email de entrada com a marca Velah |
