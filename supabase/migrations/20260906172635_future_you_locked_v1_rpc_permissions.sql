-- The Locked v1 starter is an internal transaction called only by the protected
-- Edge Function. Explicitly remove Supabase's default API-role grants.
revoke all on function public.future_you_start_locked_intake(uuid, text, text) from anon, authenticated, public;
grant execute on function public.future_you_start_locked_intake(uuid, text, text) to service_role;
