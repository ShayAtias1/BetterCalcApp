-- Review follow-up: commercial_flag(key) is only called by the server-side functions (which run with their
-- owner's rights), so API users do not need it. It answered for any settings key, including internal ones.
revoke execute on function public.commercial_flag(text) from authenticated;
