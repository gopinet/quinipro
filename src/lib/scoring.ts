import type { Fixture, Outcome, Prediction, Source } from './types';

export function outcomeOf(home: number, away: number): Outcome {
  return home > away ? 'H' : home < away ? 'A' : 'D';
}

/** 3 = exact score, 1 = correct result (1X2), 0 = miss. null if not played. */
export function pointsFor(pred: Prediction, fx: Fixture): number | null {
  if (fx.final_home === null || fx.final_away === null) return null;
  if (pred.pred_home === fx.final_home && pred.pred_away === fx.final_away) return 3;
  if (pred.outcome === outcomeOf(fx.final_home, fx.final_away)) return 1;
  return 0;
}

export interface Score {
  source: Source;
  points: number;
  exact: number;
  results: number;
  graded: number; // matches that have finished and were predicted
}

export function leaderboard(
  predictions: Prediction[],
  fixturesById: Map<number, Fixture>,
): Score[] {
  const init = (source: Source): Score => ({ source, points: 0, exact: 0, results: 0, graded: 0 });
  const acc: Record<Source, Score> = { ai: init('ai'), me: init('me') };

  for (const p of predictions) {
    const fx = fixturesById.get(p.fixture_id);
    if (!fx) continue;
    const pts = pointsFor(p, fx);
    if (pts === null) continue;
    const s = acc[p.source];
    s.points += pts;
    s.graded += 1;
    if (pts === 3) s.exact += 1;
    else if (pts === 1) s.results += 1;
  }
  return [acc.ai, acc.me];
}
