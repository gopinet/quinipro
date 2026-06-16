import type { APIRoute } from 'astro';
import { gatherStats } from '@/lib/apisports';
import { getFixture, getMatchNotes, getPredictions, insertPrediction, setStats } from '@/lib/db';
import { predictMatch } from '@/lib/llm';

export const prerender = false;

// POST /api/predict  body: { fixtureId: number }
export const POST: APIRoute = async ({ request }) => {
  try {
    const { fixtureId } = await request.json();
    const fx = await getFixture(Number(fixtureId));
    if (!fx) return Response.json({ ok: false, error: 'fixture_not_found' }, { status: 404 });

    // Predictions are frozen at kickoff. No cheating.
    if (new Date() >= new Date(fx.kickoff)) {
      return Response.json({ ok: false, error: 'match_started' }, { status: 409 });
    }

    // Immutable: don't regenerate if AI already predicted.
    const existing = (await getPredictions(fx.id)).find((p) => p.source === 'ai');
    if (existing) return Response.json({ ok: true, prediction: existing, cached: true });

    // Gather stats + world cup knowledge in parallel, then ask the LLM.
    const [stats, notes] = await Promise.all([
      fx.stats
        ? Promise.resolve(fx.stats)
        : gatherStats({
            id: fx.id, league_id: fx.league_id, season: fx.season,
            home_team: fx.home_team, away_team: fx.away_team,
            home_id: fx.home_id, away_id: fx.away_id,
            home_logo: fx.home_logo, away_logo: fx.away_logo,
            referee: fx.referee,
            kickoff: fx.kickoff, status: fx.status,
            final_home: fx.final_home, final_away: fx.final_away,
          }),
      getMatchNotes(fx.home_id, fx.away_id).catch(() => []),
    ]);
    if (!fx.stats) await setStats(fx.id, stats);

    const ai = await predictMatch(fx.home_team, fx.away_team, stats, notes);
    const res = await insertPrediction({
      fixture_id: fx.id,
      source: 'ai',
      pred_home: ai.pred_home,
      pred_away: ai.pred_away,
      outcome: ai.outcome,
      confidence: ai.confidence,
      reasoning: ai.reasoning,
      report: ai.report,
    });
    if (!res.ok) return Response.json({ ok: false, error: res.reason }, { status: 409 });

    return Response.json({ ok: true, prediction: ai });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
