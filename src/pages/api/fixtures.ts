import type { APIRoute } from 'astro';
import { getAllFixtures } from '@/lib/apisports';
import { getFixtures, upsertFixtures } from '@/lib/db';
import { DEFAULT_LEAGUE, DEFAULT_SEASON } from 'astro:env/server';

export const prerender = false;

// GET /api/fixtures?league=1&season=2026&refresh=1
export const GET: APIRoute = async ({ url }) => {
  const league = Number(url.searchParams.get('league') ?? DEFAULT_LEAGUE);
  const season = Number(url.searchParams.get('season') ?? DEFAULT_SEASON);
  const refresh = url.searchParams.get('refresh') === '1';

  try {
    if (refresh) {
      const rows = await getAllFixtures(league, season);
      await upsertFixtures(rows);
    }
    const fixtures = await getFixtures(league, season);
    return Response.json({ ok: true, fixtures });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
