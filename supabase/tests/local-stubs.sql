-- Stand-ins for Supabase's auth, storage and roles so the migration can be tested on plain Postgres.
-- Used only by scripts/test-db.sh. Never run this against a real Supabase project.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth; create schema storage; create schema extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), phone text, phone_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
