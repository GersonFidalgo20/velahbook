-- Velah Books · limpeza antes do lançamento (correr no SQL Editor do Supabase)
-- 1. Tabela temporária usada para carregar os primeiros livros (já sem acesso público)
drop table if exists public.seed_inbox;
-- 2. Dados e conta de teste usados nos testes de ponta a ponta (conta já bloqueada)
delete from public.print_leads where user_id = (select id from auth.users where email = 'teste.velah@example.com');
delete from public.orders where user_id = (select id from auth.users where email = 'teste.velah@example.com');
delete from public.gifts where created_by = (select id from auth.users where email = 'teste.velah@example.com');
delete from public.print_codes where batch = 'teste';
delete from auth.users where email = 'teste.velah@example.com';
