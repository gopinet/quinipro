# quinipro

App personal (sin login) para comparar pronósticos de partidos: **IA vs Yo**.
Astro (SSR) + api-sports.io + OpenAI + Supabase.

## Stack y por qué
- **Astro `output: 'server'` + adapter node**: todo lo que toca secretos corre en
  servidor. Nada llega al cliente.
- **`astro:env`**: env tipado y **validado al arrancar** (fail-fast). Si falta un
  secreto, el servidor responde 500 a propósito — un server mal configurado debe
  gritar, no mostrar "sin datos" en silencio. No requiere rebuild para cambiar secretos.
- **Supabase**: cachea fixtures, resultados, stats y pronósticos. Sin login → RLS
  apagada; todas las escrituras pasan por el servidor con la `service_role` key.
- **OpenAI**: pronóstico de la IA con salida estructurada (`json_schema`). Modelo
  configurable vía `OPENAI_MODEL`.

## Setup
```bash
npm install
cp .env.example .env   # rellena tus claves
```
1. Crea el proyecto en Supabase y corre `supabase/schema.sql` en el SQL editor.
2. Pon tus claves en `.env` (todas server-only; ver `.env.example`).
3. `npm run dev`

## Flujo
1. **Refrescar partidos** → `GET /api/fixtures?refresh=1` trae y cachea fixtures.
2. Entra a un partido → **Generar pronóstico IA**: reúne stats (1 vez), llama al LLM,
   guarda inmutable.
3. Mete **tu pronóstico** antes del kickoff.
4. Tras jugarse → **Sincronizar resultados** → `GET /api/sync-results`.
5. Marcador IA vs Yo automático: 3 pts marcador exacto, 1 pt resultado 1X2.

## Análisis de la IA (informe de 5 secciones por partido)
Cada pronóstico de la IA genera un informe técnico con salida estructurada:
1. **Contexto**: sede, prob. 1X2 (del mercado) y prob. de ambos marcan (BTTS).
2. **Forma actual**: rachas, posesión prom., xG (si hay), resultados últimos 5.
3. **Patrones y estadísticas clave**: estilo + tiros dentro del área, etc.
4. **Árbitro, tarjetas y córners**: nombre del árbitro + rangos proyectados.
5. **Predicción**: ritmo, portería a cero, quién abre el marcador.

### Señal que recibe la IA (`gatherStats`, ~15-18 llamadas/partido, cacheado)
- **Cuotas 1X2 + BTTS** (la mejor señal) con probabilidades implícitas.
- **Standings**, **splits por localía**, **forma**, **head-to-head**, **lesiones**.
- **Agregados de los últimos 5 partidos** (vía `/fixtures/statistics`): posesión,
  córners, amarillas, tiros dentro del área y **xG** prom.
- **Nombre del árbitro** designado.

> ⚠️ Lo que api-sports v3 NO entrega y por tanto la IA marca como "dato no disponible"
> (NO lo inventa): **toques en el área, entradas al último tercio, duelos aéreos, e
> historial de tarjetas/córners del árbitro**. Además, **xG tiene cobertura parcial**
> (vacío en muchas ligas/temporadas). Si necesitas esas métricas de verdad, requieres
> un proveedor tipo Opta/StatsBomb; api-sports no las tiene.

> ⚠️ Las rutas de campos siguen la doc de api-sports v3 pero NO se probaron contra una
> respuesta real. Valida `/odds` (bets "Match Winner" y "Both Teams Score"),
> `/fixtures/statistics` (tipos "Ball Possession", "Corner Kicks", "Shots insidebox",
> "expected_goals"), `/injuries` y `/standings` con tu key. El código es defensivo.

## Reglas que protegen el juego
- Pronósticos **congelados al kickoff** (tuyo y de la IA). Los endpoints rechazan
  writes si `now >= kickoff`.
- Pronóstico **inmutable**: `unique(fixture_id, source)` impide regenerar. El LLM no
  se llama en cada carga.

## Endpoints
| Método | Ruta | Qué hace |
|---|---|---|
| GET  | `/api/fixtures?league=&season=&refresh=1` | Trae/cachea fixtures |
| POST | `/api/predict` `{fixtureId}` | Pronóstico IA (1 vez) |
| POST | `/api/my-prediction` `{fixtureId,home,away}` | Tu pronóstico |
| GET  | `/api/sync-results?league=&season=` | Actualiza resultados finales |

## Producción
`npm run build && npm start` (runtime node). Serverless → cambia el adapter
(`@astrojs/vercel` / `@astrojs/netlify`).

## Límite honesto
Aun con cuotas + stats, la IA básicamente **calibra hacia el mercado**: rara vez le
gana a la casa. Es un buen rival para el juego IA-vs-tú, no una máquina de apostar.
