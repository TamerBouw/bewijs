// Bewakingsregels voor de balie-agent (FICTIEF oefenpakket). Pure functie: werkt in Deno en in Node.

export interface Alert {
  soort: 'geen_run' | 'kosten' | 'fouten';
  melding: string;
}

export interface Run {
  gestart_op: string;
  status: 'ok' | 'fout' | 'afgebroken';
  kosten_eur: number;
}

/** Uur van de dag in Nederland (0-23). */
export function uurInNederland(moment: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hourCycle: 'h23' }).format(moment));
}

/**
 * Drie vragen: draait hij (geen_run), wat kost hij (kosten), doet hij het goed (fouten).
 * - geen_run: tussen 09.00 en 21.00 uur Nederlandse tijd langer dan 3 uur geen geslaagde run
 * - kosten: modelkosten deze kalendermaand (UTC) op of boven 80% van de maandlimiet
 * - fouten: in de laatste 24 uur minstens 5 runs, en meer dan 20% met status fout
 */
export function bepaalAlerts(runs: Run[], nu: Date, maandlimietEur: number): Alert[] {
  const alerts: Alert[] = [];
  const uur = uurInNederland(nu);

  const geslaagd = runs.filter((r) => r.status === 'ok').map((r) => Date.parse(r.gestart_op));
  const laatste = geslaagd.length > 0 ? Math.max(...geslaagd) : null;
  const urenStil = laatste === null ? Infinity : (nu.getTime() - laatste) / 3_600_000;
  if (uur >= 9 && uur < 21 && urenStil > 3) {
    alerts.push({ soort: 'geen_run', melding: `Geen geslaagde run in ${laatste === null ? 'de opgehaalde periode' : `${urenStil.toFixed(1)} uur`}.` });
  }

  const maandStart = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1);
  const kosten = runs.filter((r) => Date.parse(r.gestart_op) >= maandStart).reduce((som, r) => som + Number(r.kosten_eur), 0);
  if (maandlimietEur > 0 && kosten >= 0.8 * maandlimietEur) {
    alerts.push({ soort: 'kosten', melding: `Modelkosten deze maand ${kosten.toFixed(2)} euro, limiet ${maandlimietEur} euro.` });
  }

  const dag = runs.filter((r) => nu.getTime() - Date.parse(r.gestart_op) <= 24 * 3_600_000);
  const fouten = dag.filter((r) => r.status === 'fout').length;
  if (dag.length >= 5 && fouten / dag.length > 0.2) {
    alerts.push({ soort: 'fouten', melding: `${fouten} van ${dag.length} runs in 24 uur eindigden met status fout.` });
  }
  return alerts;
}
