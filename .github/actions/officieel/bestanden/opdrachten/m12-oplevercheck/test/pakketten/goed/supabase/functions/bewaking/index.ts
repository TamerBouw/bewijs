// @ts-nocheck -- Deno-code voor Supabase Edge Functions. De cursusrepo type-checkt alleen Node-code.
// Bewaking van de balie-agent: draait hij, wat kost hij, hoeveel fouten maakt hij? (FICTIEF oefenpakket)
// pg_cron stuurt de benoemde secret key "bewaking" mee in de header apikey. auth: 'secret:bewaking' laat alleen
// die sleutel door; ctx.supabaseAdmin gebruikt dezelfde sleutel. Lekt hij, dan vervang je alleen deze.
import { withSupabase } from 'npm:@supabase/server@1';
import { bepaalAlerts, type Alert, type Run } from './alerts.ts';

const KLANT = Deno.env.get('KLANT_SLUG') ?? 'onbekend';

async function stuurAlerts(alerts: Alert[]): Promise<void> {
  const antwoord = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Bewaking Vonk <bewaking@bureauvonk.example>',
      to: [Deno.env.get('ALERT_MAIL_AAN')],
      subject: `[${KLANT}] ${alerts.map((a) => a.soort).join(', ')}`,
      text: alerts.map((a) => `- ${a.melding}`).join('\n'),
    }),
  });
  if (!antwoord.ok) throw new Error(`Resend antwoordde ${antwoord.status}`);
}

export default {
  fetch: withSupabase({ auth: 'secret:bewaking' }, async (_req, ctx) => {
    const nu = new Date();
    // Vanaf het begin van de vorige maand: genoeg voor de kosten van deze maand en de laatste 24 uur.
    const sinds = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - 1, 1)).toISOString();
    const { data, error } = await ctx.supabaseAdmin.from('agent_runs').select('gestart_op, status, kosten_eur').gte('gestart_op', sinds);
    if (error) return Response.json({ status: 'fout', melding: error.message }, { status: 500 });

    const alerts = bepaalAlerts((data ?? []) as Run[], nu, Number(Deno.env.get('MAANDLIMIET_EUR') ?? '0'));
    if (alerts.length > 0) await stuurAlerts(alerts);
    return Response.json({ status: alerts.length > 0 ? 'alarm' : 'ok', alerts });
  }),
};
