import type { APIRoute } from 'astro';
import { getFixture, insertPrediction } from '@/lib/db';
import { outcomeOf } from '@/lib/scoring';

export const prerender = false;

// POST /api/my-prediction  body: { fixtureId, home, away }
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const fixtureId = Number(body.fixtureId);
    const home = Math.max(0, Math.round(Number(body.home)));
    const away = Math.max(0, Math.round(Number(body.away)));
    if (!Number.isFinite(home) || !Number.isFinite(away)) {
      return Response.json({ ok: false, error: 'invalid_score' }, { status: 400 });
    }

    const fx = await getFixture(fixtureId);
    if (!fx) return Response.json({ ok: false, error: 'fixture_not_found' }, { status: 404 });
    if (new Date() >= new Date(fx.kickoff)) {
      return Response.json({ ok: false, error: 'match_started' }, { status: 409 });
    }

    const res = await insertPrediction({
      fixture_id: fx.id,
      source: 'me',
      pred_home: home,
      pred_away: away,
      outcome: outcomeOf(home, away),
      confidence: null,
      reasoning: null,
      report: null,
    });
    if (!res.ok) {
      const status = res.reason === 'already_predicted' ? 409 : 500;
      return Response.json({ ok: false, error: res.reason }, { status });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
