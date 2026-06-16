export type Outcome = 'H' | 'D' | 'A';
export type Source = 'ai' | 'me';

export interface Fixture {
  id: number;
  league_id: number;
  season: number;
  home_id: number;
  away_id: number;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  referee: string | null;
  kickoff: string; // ISO UTC
  status: string;
  final_home: number | null;
  final_away: number | null;
  stats: StatsSnapshot | null;
  updated_at: string;
}

export interface Prediction {
  id: string;
  fixture_id: number;
  source: Source;
  pred_home: number;
  pred_away: number;
  outcome: Outcome;
  confidence: number | null;
  reasoning: string | null;       // short synthesis for list views (AI)
  report: AnalysisReport | null;  // full 5-section report (AI)
  created_at: string;
}

// Aggregated advanced metrics from the last N fixtures (what api-sports CAN give).
export interface AdvancedForm {
  possession_avg: number | null;   // %
  corners_avg: number | null;
  yellows_avg: number | null;
  shots_inbox_avg: number | null;
  xg_avg: number | null;           // often null: limited api-sports coverage
  recent: string;                  // e.g. "W2-1 L0-2 D1-1 W3-0 W1-0"
}

export interface TeamForm {
  team: string;
  last5: string;
  rank: number | null;
  points: number | null;
  goals_for_avg: number | null;
  goals_against_avg: number | null;
  venue_record: string;
  clean_sheets: number | null;
  injuries: number;
  advanced: AdvancedForm;
}

export interface MatchOdds {
  bookmaker: string;
  home: number;
  draw: number;
  away: number;
  implied: { home: number; draw: number; away: number }; // %, overround-normalized
}

export interface BttsOdds {
  yes: number;
  no: number;
  implied_yes: number; // %
}

export interface StatsSnapshot {
  home: TeamForm;
  away: TeamForm;
  h2h: string;
  referee: string | null;
  odds: MatchOdds | null;
  btts: BttsOdds | null;
  gathered_at: string;
}

// The 5-section analyst report the LLM must produce.
export interface AnalysisReport {
  contexto: string;     // 1. sede, prob. 1X2, BTTS
  forma: string;        // 2. forma reciente, rachas, posesión, xG, últimos 4-5
  patrones: string;     // 3. estilo y estadísticas clave
  disciplina: string;   // 4. árbitro, tarjetas, córners
  prediccion: string;   // 5. síntesis, ritmo, portería a cero, quién abre
}

/** One match note = LLM-generated knowledge from a finished WC match. */
export interface MatchNote {
  fixture_id:       number;
  home_team:        string;
  away_team:        string;
  home_id:          number;
  away_id:          number;
  final_home:       number;
  final_away:       number;
  events:           any[] | null;
  summary:          string;
  home_performance: string;
  away_performance: string;
  key_takeaways:    string;
  created_at:       string;
}

export interface AiPrediction {
  pred_home: number;
  pred_away: number;
  outcome: Outcome;
  confidence: number;
  reasoning: string;
  report: AnalysisReport;
}
