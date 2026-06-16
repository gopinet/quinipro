import OpenAI from 'openai';
import { OPENAI_API_KEY, OPENAI_MODEL } from 'astro:env/server';
import type { AiPrediction, MatchNote, Outcome, StatsSnapshot } from './types';

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY });
  return _client;
}

const SYSTEM = `Actúa como un analista de datos experto en fútbol y modelos de predicción
deportiva. Tono técnico, objetivo y basado en datos.

REGLA CRÍTICA: usa SOLO los datos provistos. Si una métrica NO aparece en los datos
(p. ej. xG cuando viene vacío, toques en el área, entradas al último tercio, duelos
aéreos, o el historial del árbitro), escribe explícitamente "dato no disponible" para
esa métrica. NUNCA inventes cifras. Las probabilidades del mercado (1X2 y BTTS) son la
señal más fuerte: úsalas como prior para el marcador y la confianza.

Devuelve el informe en las secciones del esquema. pred_home/pred_away es tu marcador
final estimado; confidence (0-1) refleja qué tan cerrado es el partido.`;

const SCHEMA = {
  name: 'analisis_ia',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pred_home: { type: 'integer', minimum: 0 },
      pred_away: { type: 'integer', minimum: 0 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string', description: 'Síntesis de una frase para listados' },
      contexto: { type: 'string', description: '1. Sede, prob. 1X2 (modelo de distribución) y prob. de ambos equipos marcan' },
      forma: { type: 'string', description: '2. Forma reciente, rachas, posesión promedio, xG y resultados clave últimos 4-5' },
      patrones: { type: 'string', description: '3. Estilo predominante y estadísticas clave' },
      disciplina: { type: 'string', description: '4. Árbitro, rango de tarjetas y rango de córners' },
      prediccion: { type: 'string', description: '5. Síntesis: ritmo, portería a cero, quién abre el marcador' },
    },
    required: ['pred_home', 'pred_away', 'confidence', 'reasoning', 'contexto', 'forma', 'patrones', 'disciplina', 'prediccion'],
  },
} as const;

function outcomeFrom(h: number, a: number): Outcome {
  return h > a ? 'H' : h < a ? 'A' : 'D';
}

const f = (v: number | null | undefined, suffix = '') =>
  v === null || v === undefined ? 'no disponible' : `${v}${suffix}`;

function describe(s: StatsSnapshot): string {
  const team = (x: StatsSnapshot['home']) => {
    const a = x.advanced;
    return [
      `${x.team}:`,
      `  forma(5): ${x.last5} | resultados: ${a.recent}`,
      `  posición: ${f(x.rank)} (${f(x.points)} pts) | récord: ${x.venue_record}`,
      `  goles a favor/contra prom: ${f(x.goals_for_avg)}/${f(x.goals_against_avg)} | porterías a cero: ${f(x.clean_sheets)}`,
      `  posesión prom: ${f(a.possession_avg, '%')} | xG prom: ${f(a.xg_avg)} | córners prom: ${f(a.corners_avg)}`,
      `  tiros dentro área prom: ${f(a.shots_inbox_avg)} | amarillas prom: ${f(a.yellows_avg)} | bajas: ${x.injuries}`,
    ].join('\n');
  };
  const odds = s.odds
    ? `Cuotas 1X2 (${s.odds.bookmaker}): L ${s.odds.home} / E ${s.odds.draw} / V ${s.odds.away} → prob ${s.odds.implied.home}%/${s.odds.implied.draw}%/${s.odds.implied.away}%`
    : 'Cuotas 1X2: no disponibles';
  const btts = s.btts
    ? `BTTS: Sí ${s.btts.yes} / No ${s.btts.no} → prob Sí ${s.btts.implied_yes}%`
    : 'BTTS: no disponible';
  return [
    team(s.home),
    team(s.away),
    `H2H: ${s.h2h}`,
    `Árbitro designado: ${s.referee ?? 'no disponible'} (historial de tarjetas/córners del árbitro: no disponible)`,
    odds,
    btts,
    'Métricas NO disponibles en la fuente: toques en el área, entradas al último tercio, duelos aéreos.',
  ].join('\n');
}

const SUMMARY_SCHEMA = {
  name: 'match_summary',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary:          { type: 'string', description: 'Narrativa del partido: qué pasó y por qué (2-3 frases)' },
      home_performance: { type: 'string', description: 'Valoración del equipo local en este partido' },
      away_performance: { type: 'string', description: 'Valoración del equipo visitante en este partido' },
      key_takeaways:    { type: 'string', description: 'Puntos clave a recordar para futuros análisis de estos equipos' },
    },
    required: ['summary', 'home_performance', 'away_performance', 'key_takeaways'],
  },
} as const;

/** Generate a structured knowledge note from a finished WC match (goals + cards). */
export async function summarizeMatch(
  homeTeam: string, awayTeam: string,
  finalHome: number, finalAway: number,
  events: any[],
): Promise<Pick<MatchNote, 'summary' | 'home_performance' | 'away_performance' | 'key_takeaways'>> {
  const goals = events
    .filter((e) => e.type === 'Goal')
    .map((e) => `${e.time.elapsed}' ${e.team.name}: ${e.player.name}${e.detail === 'Own Goal' ? ' (gol en propia)' : ''}`)
    .join('\n') || 'no disponible';
  const cards = events
    .filter((e) => e.type === 'Card')
    .map((e) => `${e.time.elapsed}' ${e.team.name}: ${e.player.name} (${e.detail})`)
    .join('\n') || 'ninguna';

  const user = `PARTIDO FINALIZADO — Mundial 2026:
${homeTeam} ${finalHome}–${finalAway} ${awayTeam}

GOLES:
${goals}

TARJETAS:
${cards}

Genera el resumen estructurado para memoria del analista.`;

  const completion = await client().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: SUMMARY_SCHEMA },
    messages: [
      { role: 'system', content: 'Eres un analista experto en fútbol del Mundial 2026. Genera resúmenes objetivos y concisos de partidos para alimentar el análisis predictivo de futuros encuentros.' },
      { role: 'user', content: user },
    ],
  });

  const p = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
  return {
    summary:          String(p.summary ?? ''),
    home_performance: String(p.home_performance ?? ''),
    away_performance: String(p.away_performance ?? ''),
    key_takeaways:    String(p.key_takeaways ?? ''),
  };
}

/** Format match notes as additional context for the prediction prompt. */
function describeNotes(notes: MatchNote[], homeTeam: string, awayTeam: string): string {
  if (notes.length === 0) return '';
  const fmt = (n: MatchNote, team: string) => {
    const opp  = n.home_team === team ? n.away_team : n.home_team;
    const perf = n.home_team === team ? n.home_performance : n.away_performance;
    return `  • vs ${opp} (${n.final_home}–${n.final_away}): ${perf}`;
  };
  const homeNotes = notes.filter((n) => n.home_team === homeTeam || n.away_team === homeTeam);
  const awayNotes = notes.filter((n) => n.home_team === awayTeam || n.away_team === awayTeam);
  const lines: string[] = ['\n\n## MEMORIA DEL MUNDIAL 2026 (partidos previos relevantes):'];
  if (homeNotes.length > 0) {
    lines.push(`\n${homeTeam} en el torneo:`);
    homeNotes.forEach((n) => lines.push(fmt(n, homeTeam)));
    const last = homeNotes[homeNotes.length - 1];
    if (last) lines.push(`  → Conclusión: ${last.key_takeaways}`);
  }
  if (awayNotes.length > 0) {
    lines.push(`\n${awayTeam} en el torneo:`);
    awayNotes.forEach((n) => lines.push(fmt(n, awayTeam)));
    const last = awayNotes[awayNotes.length - 1];
    if (last) lines.push(`  → Conclusión: ${last.key_takeaways}`);
  }
  return lines.join('\n');
}

export async function predictMatch(
  homeTeam: string, awayTeam: string,
  stats: StatsSnapshot,
  notes: MatchNote[] = [],
): Promise<AiPrediction> {
  const worldcupCtx = describeNotes(notes, homeTeam, awayTeam);
  const user = `Equipos: ${homeTeam} (local) vs ${awayTeam} (visitante)\n\nDATOS DISPONIBLES:\n${describe(stats)}${worldcupCtx}\n\nGenera el informe de Análisis de la IA.`;

  const completion = await client().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.4,
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
  });

  const msg = completion.choices[0]?.message;
  if (msg?.refusal) throw new Error(`LLM refused: ${msg.refusal}`);
  const p = JSON.parse(msg?.content ?? '{}');

  const pred_home = Math.max(0, Math.round(Number(p.pred_home ?? 0)));
  const pred_away = Math.max(0, Math.round(Number(p.pred_away ?? 0)));
  const confidence = Math.min(1, Math.max(0, Number(p.confidence ?? 0.5)));

  return {
    pred_home,
    pred_away,
    outcome: outcomeFrom(pred_home, pred_away),
    confidence,
    reasoning: String(p.reasoning ?? '').slice(0, 300),
    report: {
      contexto: String(p.contexto ?? ''),
      forma: String(p.forma ?? ''),
      patrones: String(p.patrones ?? ''),
      disciplina: String(p.disciplina ?? ''),
      prediccion: String(p.prediccion ?? ''),
    },
  };
}
