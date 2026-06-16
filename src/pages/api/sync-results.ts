import type { APIRoute } from 'astro';
import { getFixturesByIds } from '@/lib/apisports';
import { getFixtures, upsertFixtures } from '@/lib/db';
import { DEFAULT_LEAGUE, DEFAULT_SEASON } from 'astro:env/server';

export const prerender = false;

// GET /api/sync-results?league=39&season=2024
// Refetches fixtures that haven't finished yet and updates their final score.
export const GET: APIRoute = async ({ url }) => {
  const league = Number(url.searchParams.get('league') ?? DEFAULT_LEAGUE);
  const season = Number(url.searchParams.get('season') ?? DEFAULT_SEASON);

  try {
    const cached = await getFixtures(league, season);
    const pending = cached
      .filter((f) => new Date(f.kickoff) < new Date())
      .map((f) => f.id);

    if (pending.length === 0) {
      return Response.json({ ok: true, updated: 0 });
    }

    const fresh = await getFixturesByIds(pending);
    await upsertFixtures(fresh);
    const updated = fresh.filter((f) => f.final_home !== null).length;
    return Response.json({ ok: true, updated });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
