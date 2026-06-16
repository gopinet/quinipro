import { db } from './supabase';
import type { Fixture, MatchNote, Prediction } from './types';
import type { RawFixture } from './apisports';

export async function upsertFixtures(rows: RawFixture[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    id: r.id,
    league_id: r.league_id,
    season: r.season,
    home_id: r.home_id,
    away_id: r.away_id,
    home_team: r.home_team,
    away_team: r.away_team,
    home_logo: r.home_logo,
    away_logo: r.away_logo,
    referee: r.referee,
    kickoff: r.kickoff,
    status: r.status,
    final_home: r.final_home,
    final_away: r.final_away,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db().from('fixtures').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(`upsertFixtures: ${error.message}`);
}

export async function getFixtures(league: number, season: number): Promise<Fixture[]> {
  const { data, error } = await db()
    .from('fixtures')
    .select('*')
    .eq('league_id', league)
    .eq('season', season)
    .order('kickoff', { ascending: true });
  if (error) throw new Error(`getFixtures: ${error.message}`);
  return (data ?? []) as Fixture[];
}

export async function getFixture(id: number): Promise<Fixture | null> {
  const { data, error } = await db().from('fixtures').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getFixture: ${error.message}`);
  return (data as Fixture) ?? null;
}

export async function getPredictions(fixtureId?: number): Promise<Prediction[]> {
  let q = db().from('predictions').select('*');
  if (fixtureId !== undefined) q = q.eq('fixture_id', fixtureId);
  const { data, error } = await q;
  if (error) throw new Error(`getPredictions: ${error.message}`);
  return (data ?? []) as Prediction[];
}

/** Insert a prediction. Fails (and returns false) if one already exists for fixture+source. */
export async function insertPrediction(p: Omit<Prediction, 'id' | 'created_at'>): Promise<{ ok: boolean; reason?: string }> {
  const { error } = await db().from('predictions').insert(p);
  if (error) {
    // 23505 = unique_violation -> prediction already locked in
    if (error.code === '23505') return { ok: false, reason: 'already_predicted' };
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function setStats(fixtureId: number, stats: Fixture['stats']): Promise<void> {
  const { error } = await db().from('fixtures').update({ stats }).eq('id', fixtureId);
  if (error) throw new Error(`setStats: ${error.message}`);
}

/** Fetch all match notes that involve either of the two teams (by team id). */
export async function getMatchNotes(homeId: number, awayId: number): Promise<MatchNote[]> {
  const { data, error } = await db()
    .from('match_notes')
    .select('*')
    .or(`home_id.eq.${homeId},away_id.eq.${homeId},home_id.eq.${awayId},away_id.eq.${awayId}`)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getMatchNotes: ${error.message}`);
  return (data ?? []) as MatchNote[];
}

/** Get a single match note by fixture id (null if not yet generated). */
export async function getMatchNote(fixtureId: number): Promise<MatchNote | null> {
  const { data, error } = await db()
    .from('match_notes')
    .select('*')
    .eq('fixture_id', fixtureId)
    .maybeSingle();
  if (error) throw new Error(`getMatchNote: ${error.message}`);
  return (data as MatchNote) ?? null;
}

export async function upsertMatchNote(note: Omit<MatchNote, 'created_at'>): Promise<void> {
  const { error } = await db().from('match_notes').upsert(note, { onConflict: 'fixture_id' });
  if (error) throw new Error(`upsertMatchNote: ${error.message}`);
}
