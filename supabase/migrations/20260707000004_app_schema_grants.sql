-- The `app` schema holds security-definer helper functions used by RLS policies
-- and by the invoker-security RPC functions (create_project, approve_project, etc).
-- Supabase's PostgREST roles (anon, authenticated) only get USAGE on `public` by
-- default; without USAGE on `app`, invoker-security functions calling app.my_role()/
-- app.my_org() fail with "permission denied for schema app".
grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated, anon;
alter default privileges in schema app grant execute on functions to authenticated, anon;
