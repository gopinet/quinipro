import type { APIRoute } from 'astro';
import { getFixtureEvents } from '@/lib/apisports';
import { getFixture, upsertMatchNote } from '@/lib/db';
import { summarizeMatch } from '@/lib/llm';

export const prerender = false;

// POST /api/build-knowledge  body: { fixtureId: number }
// Fetches events from api-sports (Pro), asks the LLM to summarise the match,
// and stores the result in match_notes for future predictions.
export const POST: APIRoute = async ({ request }) => {
  try {
    const { fixtureId } = await request.json();
    const fx = await getFixture(Number(fixtureId));
    if (!fx) return Response.json({ ok: false, error: 'fixture_not_found' }, { status: 404 });
    if (fx.final_home === null || fx.final_away === null) {
      return Response.json({ ok: false, error: 'match_not_finished' }, { status: 409 });
    }

    const events = await getFixtureEvents(fx.id);
    const summary = await summarizeMatch(
      fx.home_team, fx.away_team,
      fx.final_home, fx.final_away,
      events,
    );

    await upsertMatchNote({
      fixture_id:       fx.id,
      home_team:        fx.home_team,
      away_team:        fx.away_team,
      home_id:          fx.home_id,
      away_id:          fx.away_id,
      final_home:       fx.final_home,
      final_away:       fx.final_away,
      events:           events.length > 0 ? events : null,
      ...summary,
    });

    return Response.json({ ok: true, summary });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
