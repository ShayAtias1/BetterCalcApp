// Scheduled maintenance (Supabase Edge Function, Deno): removes abandoned cloud uploads and carries out account
// deletion requests. Invoked by pg_cron through pg_net with the MAINTENANCE_SECRET header; see docs/SUPABASE-SETUP.md.
// The service-role key is the function's own environment variable and never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runMaintenance, secretMatches, type MaintenanceClient } from '../_shared/maintenance.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!secretMatches(req.headers.get('x-maintenance-secret'), Deno.env.get('MAINTENANCE_SECRET'))) {
    return new Response('forbidden', { status: 403 });
  }
  const graceDays = Number(Deno.env.get('ACCOUNT_DELETION_GRACE_DAYS') ?? '7');
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const report = await runMaintenance(client as unknown as MaintenanceClient, graceDays);
    // Ids and counts only: no names, emails or file contents in the logs.
    console.log(JSON.stringify(report));
    return Response.json(report, { status: report.failures.length ? 207 : 200 });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return new Response('maintenance failed', { status: 500 });
  }
});
