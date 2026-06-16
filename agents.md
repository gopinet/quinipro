# agents.md — Guía para agentes de IA en quinipro

## Resumen del proyecto
App personal (sin login) para comparar pronósticos de partidos: **IA vs Yo**.
Stack: **Astro 5 SSR** + **@astrojs/node standalone** + **api-sports.io v3** + **OpenAI** + **Supabase**.
Todo lo que toca secretos corre en servidor. El cliente nunca recibe claves.

---

## Estructura del código

```
src/
  lib/
    apisports.ts   — cliente de api-sports.io; funciones: getUpcomingFixtures, getFixturesByIds, gatherStats
    db.ts          — CRUD sobre Supabase; funciones: upsertFixtures, getFixture(s), getPredictions, insertPrediction, setStats
    llm.ts         — llamada a OpenAI con json_schema; función: predictMatch → AiPrediction
    scoring.ts     — lógica de puntuación (3 pts exacto, 1 pt 1X2); funciones: pointsFor, leaderboard
    supabase.ts    — singleton del cliente Supabase (service_role)
    types.ts       — todos los tipos TypeScript del dominio
  pages/
    index.astro    — página principal SSR
    fixture/[id].astro
    api/
      fixtures.ts       — GET /api/fixtures?league=&season=&refresh=1
      predict.ts        — POST /api/predict  { fixtureId }
      my-prediction.ts  — POST /api/my-prediction  { fixtureId, home, away }
      sync-results.ts   — GET /api/sync-results?league=&season=
supabase/
  schema.sql       — tablas: fixtures, predictions. Idempotente; corre en SQL editor de Supabase.
astro.config.mjs   — output:'server', env schema validado (fail-fast si falta un secreto)
```

---

## Convenciones y reglas del proyecto

### Variables de entorno
Definidas en `astro.config.mjs` con `envField`. Se importan desde `astro:env/server`.
**Nunca** uses `process.env` directamente ni expongas nada al cliente.
Variables requeridas: `FOOTBALL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`.
Opcionales con defaults: `OPENAI_MODEL` (gpt-4o-mini), `DEFAULT_LEAGUE` (39), `DEFAULT_SEASON` (2024).

### Base de datos (Supabase)
- RLS **apagada**; todas las escrituras van por el servidor con `service_role`.
- Tabla `fixtures`: upsert por `id` (api-sports fixture id). El campo `stats` guarda el `StatsSnapshot` cacheado como JSONB.
- Tabla `predictions`: `unique(fixture_id, source)` → los pronósticos son **inmutables**. El código maneja el error `23505` (unique_violation) devolviendo `{ ok: false, reason: 'already_predicted' }`.
- No añadas `anon key` con políticas de escritura abierta.

### Endpoints — invariantes de negocio
- **Kickoff freeze**: toda escritura rechaza si `now >= fx.kickoff`. No toques esta lógica.
- **Pronóstico IA inmutable**: si ya existe para `(fixture_id, 'ai')`, devuelve el cacheado sin llamar al LLM.
- **Stats cacheadas**: si `fx.stats` existe, no llames a `gatherStats` de nuevo.

### LLM (llm.ts)
- Salida estructurada con `response_format: { type: 'json_schema', json_schema: SCHEMA }` y `strict: true`.
- El modelo es configurable vía `OPENAI_MODEL` (no hardcodees `gpt-4o-mini`).
- El sistema de prompt obliga a escribir "dato no disponible" para métricas ausentes. **No alteres esa instrucción.**
- El informe tiene 5 secciones fijas: `contexto`, `forma`, `patrones`, `disciplina`, `prediccion`.

### Paths de api-sports v3
Base: `https://v3.football.api-sports.io`. Header: `x-apisports-key`.
Los paths verificados en producción se documentan aquí a medida que se confirman.

---

## Plan Pro de api-sports.io (activo)
Con el plan Pro están disponibles los siguientes endpoints adicionales que el plan Free no entrega:

| Endpoint | Qué aporta al proyecto |
|---|---|
| `GET /predictions` `{ fixture }` | Predicción propia de api-sports (prob. home/draw/away, bajo/alto, consejo). Señal extra muy valiosa para el LLM. |
| `GET /fixtures/lineups` `{ fixture }` | Alineaciones confirmadas antes del partido. Permite detectar titulares/suplentes clave. |
| `GET /fixtures/events` `{ fixture }` | Eventos en directo (goles, tarjetas, sustituciones). Útil para sync-results en tiempo real. |
| `GET /fixtures/statistics` | Cobertura **más amplia** de ligas y temporadas con el Pro (incluye xG con mejor cobertura). |
| `GET /players` `{ fixture }` | Stats individuales post-partido (pases, disparos, nota). |
| `GET /players/squads` `{ team }` | Plantilla completa del equipo. |

### Mejoras ya identificadas que el Pro desbloquea

1. **Añadir `/predictions` a `gatherStats`**: añadir una llamada en el `Promise.all` de `gatherStats` para traer la predicción de api-sports y exponerla al LLM como señal adicional junto a las cuotas 1X2. Esto debe añadirse en `src/lib/apisports.ts` e incluirse en `StatsSnapshot` (en `types.ts`).

2. **Añadir alineaciones confirmadas**: `GET /fixtures/lineups?fixture=ID` devuelve los once titulares. Incorporarlo en `StatsSnapshot` como `lineups?: { home: string[]; away: string[] }` y describírselo al LLM en `describe()`.

3. **xG con mejor cobertura**: el Pro amplía la cobertura de `expected_goals` en `/fixtures/statistics`. No requiere cambios de código, solo se beneficia automáticamente.

4. **sync-results más rico**: opcionalmente enriquecer `sync-results` con eventos del partido para mostrar goleadores en la vista de fixture.

> **Prioridad sugerida**: implementar primero el endpoint `/predictions` (mayor impacto en calidad del análisis con cambio mínimo de código).

---

## Flujo de llamadas de API por acción

### Refrescar fixtures (`GET /api/fixtures?refresh=1`)
`/fixtures?league=&season=&next=20` → upsert en Supabase

### Generar pronóstico IA (`POST /api/predict`)
`Promise.all` de ~8 llamadas paralelas + 2×5 llamadas para `recentAdvanced` (home/away):
1. `/standings`
2. `/teams/statistics` (home)
3. `/teams/statistics` (away)
4. `/fixtures/headtohead`
5. `/injuries`
6. `recentAdvanced(home_id)` → `/fixtures?team=&last=5` + 5×`/fixtures/statistics`
7. `recentAdvanced(away_id)` → ídem
8. `/odds`

Con el Pro: añadir `/predictions` aquí.

### Sincronizar resultados (`GET /api/sync-results`)
`/fixtures?ids=ID1-ID2-...` solo para fixtures sin resultado y con kickoff pasado.

---

## Lo que api-sports NO entrega (ni con Pro)
Incluso en Pro, la IA debe marcar como "dato no disponible":
- Toques en el área (área chica), entradas al último tercio, duelos aéreos.
- Historial de tarjetas/córners del árbitro (no existe en ningún endpoint de api-sports).

Estas métricas requieren proveedores tipo Opta o StatsBomb. No añadas lógica para inventarlas.

---

## Qué NO hacer
- No mutes `astro.config.mjs` para añadir variables al contexto `client`; todos los secretos son `server`.
- No desactives `strict: true` en el JSON schema del LLM.
- No añadas RLS ni auth; la app es personal y sin login intencionalmente.
- No rompas la inmutabilidad de pronósticos (no añadas lógica de "regenerar").
- No hagas `fetch` a api-sports desde el cliente (browser); solo desde el servidor.
- No uses `process.env` directamente; usa siempre `astro:env/server`.

---

## Comandos útiles
```bash
npm run dev        # dev server (SSR, hot reload)
npm run check      # type-check con astro check
npm run build      # build de producción
npm start          # sirve el build (node standalone)
```

## Verificación tras cambios en apisports.ts
Los paths de la API son sensibles. Tras añadir un nuevo endpoint:
1. Pruébalo con `curl -H "x-apisports-key: $FOOTBALL_API_KEY" "https://v3.football.api-sports.io/TU_ENDPOINT?params"`.
2. Inspecciona la forma del JSON antes de parsear.
3. El código ya es defensivo (`.catch(() => null/[])`); mantén ese patrón.
