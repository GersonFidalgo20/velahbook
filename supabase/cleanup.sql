-- Velah Books · limpeza antes do lançamento (correr no SQL Editor do Supabase)
-- 1. Tabela temporária usada para carregar os primeiros livros (já sem acesso público)
drop table if exists public.seed_inbox;
-- 2. Conta de teste usada nos testes de ponta a ponta (já bloqueada)
delete from auth.users where email = 'teste.velah@example.com';
