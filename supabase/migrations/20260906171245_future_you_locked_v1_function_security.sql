-- Keep the append-only trigger function independent of a caller-controlled search path.
alter function public.future_you_forbid_mutation() set search_path = '';
