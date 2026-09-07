-- Keep the locked update ledger behind the authenticated Edge Function. New
-- public-schema tables may receive Data API grants from project defaults, so
-- remove them explicitly even though closed RLS already blocks every row.
revoke all on table public.future_you_progress_updates from anon, authenticated, service_role;
revoke all on table public.future_you_adjustment_decisions from anon, authenticated, service_role;
grant select, insert on table public.future_you_progress_updates to service_role;
grant select, insert on table public.future_you_adjustment_decisions to service_role;

-- Cover the remaining foreign-key access paths reported by the database
-- advisor. The progress-update user key is already covered by the unique
-- (user_id, client_update_id) index created in the prior migration.
create index if not exists future_you_progress_updates_correction_idx
  on public.future_you_progress_updates(correction_of_id)
  where correction_of_id is not null;
create index if not exists future_you_adjustment_decisions_user_idx
  on public.future_you_adjustment_decisions(user_id);
