import type { APIRoute } from 'astro';
import { getFixtureEvents } from '@/lib/apisports';
import { getFixtures, getMatchNote, upsertMatchNote } from '@/lib/db';
import { summarizeMatch } from '@/lib/llm';
import { DEFAULT_LEAGUE, DEFAULT_SEASON } from 'astro:env/server';

export const prerender = false;

// GET /api/build-knowledge-batch?league=1&season=2026&force=1
// Processes all finished fixtures without a match note (or all if force=1).
// Sequential to respect api-sports rate limits.
export const GET: APIRoute = async ({ url }) => {
  const league = Number(url.searchParams.get('league') ?? DEFAULT_LEAGUE);
  const season = Number(url.searchParams.get('season') ?? DEFAULT_SEASON);
  const force  = url.searchParams.get('force') === '1';

  try {
    const fixtures = await getFixtures(league, season);
    const finished = fixtures.filter(
      (f) => f.final_home !== null && f.final_away !== null,
    );

    const results: { fixture_id: number; home: string; away: string; status: 'created' | 'skipped' | 'error'; error?: string }[] = [];

    for (const fx of finished) {
      // Skip if note already exists (unless force=1)
      if (!force) {
        const existing = await getMatchNote(fx.id).catch(() => null);
        if (existing) {
          results.push({ fixture_id: fx.id, home: fx.home_team, away: fx.away_team, status: 'skipped' });
          continue;
        }
      }

      try {
        const events  = await getFixtureEvents(fx.id);
        const summary = await summarizeMatch(
          fx.home_team, fx.away_team,
          fx.final_home!, fx.final_away!,
          events,
        );
        await upsertMatchNote({
          fixture_id:  fx.id,
          home_team:   fx.home_team,
          away_team:   fx.away_team,
          home_id:     fx.home_id,
          away_id:     fx.away_id,
          final_home:  fx.final_home!,
          final_away:  fx.final_away!,
          events:      events.length > 0 ? events : null,
          ...summary,
        });
        results.push({ fixture_id: fx.id, home: fx.home_team, away: fx.away_team, status: 'created' });
      } catch (err) {
        results.push({
          fixture_id: fx.id, home: fx.home_team, away: fx.away_team,
          status: 'error', error: (err as Error).message,
        });
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errors  = results.filter((r) => r.status === 'error').length;

    return Response.json({ ok: true, created, skipped, errors, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
