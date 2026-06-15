import { FOOTBALL_API_KEY } from 'astro:env/server';
import type { AdvancedForm, BttsOdds, MatchOdds, StatsSnapshot, TeamForm } from './types';

const BASE = 'https://v3.football.api-sports.io';
const RECENT_N = 5; // matches aggregated for advanced metrics

async function api<T = any>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { 'x-apisports-key': FOOTBALL_API_KEY } });
  if (!res.ok) throw new Error(`api-sports ${path} failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`api-sports ${path} errors: ${JSON.stringify(json.errors)}`);
  }
  return json.response as T;
}

export interface RawFixture {
  id: number;
  league_id: number;
  season: number;
  home_team: string;
  away_team: string;
  home_id: number;
  away_id: number;
  home_logo: string | null;
  away_logo: string | null;
  referee: string | null;
  kickoff: string;
  status: string;
  final_home: number | null;
  final_away: number | null;
}

function mapFixture(item: any): RawFixture {
  return {
    id: item.fixture.id,
    league_id: item.league.id,
    season: item.league.season,
    home_team: item.teams.home.name,
    away_team: item.teams.away.name,
    home_id: item.teams.home.id,
    away_id: item.teams.away.id,
    home_logo: item.teams.home.logo ?? null,
    away_logo: item.teams.away.logo ?? null,
    referee: item.fixture.referee ?? null,
    kickoff: item.fixture.date,
    status: item.fixture.status.short,
    final_home: item.goals.home,
    final_away: item.goals.away,
  };
}

export async function getUpcomingFixtures(league: number, season: number, next = 20): Promise<RawFixture[]> {
  const rows = await api<any[]>('/fixtures', { league, season, next });
  return rows.map(mapFixture);
}

export async function getFixturesByIds(ids: number[]): Promise<RawFixture[]> {
  if (ids.length === 0) return [];
  const rows = await api<any[]>('/fixtures', { ids: ids.join('-') });
  return rows.map(mapFixture);
}

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};
const avg = (arr: number[]): number | null =>
  arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

/** Aggregate advanced metrics over a team's last N fixtures. ~1 + N api calls. */
async function recentAdvanced(teamId: number): Promise<AdvancedForm> {
  const fixtures = await api<any[]>('/fixtures', { team: teamId, last: RECENT_N }).catch(() => []);
  const ids = fixtures.map((f) => f.fixture.id);
  const statsArr = await Promise.all(
    ids.map((id) => api<any[]>('/fixtures/statistics', { fixture: id }).catch(() => [] as any[])),
  );

  const poss: number[] = [], corn: number[] = [], yel: number[] = [], inbox: number[] = [], xg: number[] = [];
  for (const s of statsArr) {
    const block = (s as any[]).find((x) => x?.team?.id === teamId);
    if (!block) continue;
    const get = (type: string) => block.statistics?.find((st: any) => st.type === type)?.value;
    const push = (arr: number[], v: any) => { const n = num(v); if (n !== null) arr.push(n); };
    push(poss, get('Ball Possession'));
    push(corn, get('Corner Kicks'));
    push(yel, get('Yellow Cards'));
    push(inbox, get('Shots insidebox'));
    push(xg, get('expected_goals'));
  }

  const recent = fixtures.map((f) => {
    const home = f.teams.home.id === teamId;
    const gf = home ? f.goals.home : f.goals.away;
    const ga = home ? f.goals.away : f.goals.home;
    const r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    return `${r}${gf}-${ga}`;
  }).join(' ');

  return {
    possession_avg: avg(poss),
    corners_avg: avg(corn),
    yellows_avg: avg(yel),
    shots_inbox_avg: avg(inbox),
    xg_avg: avg(xg),
    recent: recent || 'N/A',
  };
}

/** Pre-match 1X2 + BTTS from the first bookmaker offering them. One /odds call. */
async function getOdds(fixtureId: number): Promise<{ match: MatchOdds | null; btts: BttsOdds | null }> {
  const rows = await api<any[]>('/odds', { fixture: fixtureId }).catch(() => []);
  let match: MatchOdds | null = null;
  let btts: BttsOdds | null = null;

  for (const bm of rows?.[0]?.bookmakers ?? []) {
    if (!match) {
      const bet = (bm.bets ?? []).find((b: any) => b.name === 'Match Winner' || b.id === 1);
      if (bet) {
        const o = (label: string) => Number(bet.values.find((v: any) => v.value === label)?.odd);
        const home = o('Home'), draw = o('Draw'), away = o('Away');
        if ([home, draw, away].every(Number.isFinite)) {
          const inv = [1 / home, 1 / draw, 1 / away];
          const or = inv[0] + inv[1] + inv[2];
          match = {
            bookmaker: bm.name, home, draw, away,
            implied: {
              home: Math.round((inv[0] / or) * 100),
              draw: Math.round((inv[1] / or) * 100),
              away: Math.round((inv[2] / or) * 100),
            },
          };
        }
      }
    }
    if (!btts) {
      const bet = (bm.bets ?? []).find((b: any) => b.name === 'Both Teams Score' || b.name === 'Both Teams To Score' || b.id === 8);
      if (bet) {
        const o = (label: string) => Number(bet.values.find((v: any) => v.value === label)?.odd);
        const yes = o('Yes'), no = o('No');
        if ([yes, no].every(Number.isFinite)) {
          const or = 1 / yes + 1 / no;
          btts = { yes, no, implied_yes: Math.round(((1 / yes) / or) * 100) };
        }
      }
    }
    if (match && btts) break;
  }
  return { match, btts };
}

/**
 * Rich stats snapshot for the LLM. ~15-18 api calls; run ONCE per fixture
 * (predict endpoint caches it in fixtures.stats).
 * NOTE: field paths follow api-sports v3 docs; verify against a live response.
 */
export async function gatherStats(fx: RawFixture): Promise<StatsSnapshot> {
  const [standings, homeStat, awayStat, h2hRows, injuries, homeAdv, awayAdv, odds] = await Promise.all([
    api<any[]>('/standings', { league: fx.league_id, season: fx.season }).catch(() => []),
    api<any>('/teams/statistics', { league: fx.league_id, season: fx.season, team: fx.home_id }).catch(() => null),
    api<any>('/teams/statistics', { league: fx.league_id, season: fx.season, team: fx.away_id }).catch(() => null),
    api<any[]>('/fixtures/headtohead', { h2h: `${fx.home_id}-${fx.away_id}`, last: 5 }).catch(() => []),
    api<any[]>('/injuries', { fixture: fx.id }).catch(() => []),
    recentAdvanced(fx.home_id),
    recentAdvanced(fx.away_id),
    getOdds(fx.id),
  ]);

  const table: any[] = standings?.[0]?.league?.standings?.[0] ?? [];
  const standingOf = (id: number) => table.find((r) => r?.team?.id === id) ?? null;
  const injuryCount = (id: number) => (injuries as any[]).filter((i) => i?.team?.id === id).length;

  const buildForm = (stat: any, name: string, id: number, venue: 'home' | 'away', adv: AdvancedForm): TeamForm => {
    const s = Array.isArray(stat) ? stat[0] : stat;
    const st = standingOf(id);
    const w = s?.fixtures?.wins?.[venue] ?? 0;
    const d = s?.fixtures?.draws?.[venue] ?? 0;
    const l = s?.fixtures?.loses?.[venue] ?? 0;
    return {
      team: name,
      last5: (s?.form ?? '').slice(-5) || 'N/A',
      rank: st ? num(st.rank) : null,
      points: st ? num(st.points) : null,
      goals_for_avg: num(s?.goals?.for?.average?.[venue]),
      goals_against_avg: num(s?.goals?.against?.average?.[venue]),
      venue_record: `${venue === 'home' ? 'local' : 'visitante'} W${w} D${d} L${l}`,
      clean_sheets: num(s?.clean_sheet?.[venue]),
      injuries: injuryCount(id),
      advanced: adv,
    };
  };

  let hw = 0, aw = 0, dr = 0;
  for (const m of h2hRows as any[]) {
    const hWin = m?.teams?.home?.winner, aWin = m?.teams?.away?.winner;
    if (hWin === null && aWin === null) dr++;
    else if ((m.teams.home.id === fx.home_id && hWin) || (m.teams.away.id === fx.home_id && aWin)) hw++;
    else aw++;
  }

  return {
    home: buildForm(homeStat, fx.home_team, fx.home_id, 'home', homeAdv),
    away: buildForm(awayStat, fx.away_team, fx.away_id, 'away', awayAdv),
    h2h: `${fx.home_team} ${hw}W, ${dr}D, ${fx.away_team} ${aw}W (ult. ${(h2hRows as any[]).length})`,
    referee: fx.referee,
    odds: odds.match,
    btts: odds.btts,
    gathered_at: new Date().toISOString(),
  };
}
