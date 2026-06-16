import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Server output keeps every secret off the client. astro:env validates env
// at runtime (no rebuild needed to change secrets) and gives typed access.
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  env: {
    schema: {
      FOOTBALL_API_KEY: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_SERVICE_KEY: envField.string({ context: 'server', access: 'secret' }),
      OPENAI_API_KEY: envField.string({ context: 'server', access: 'secret' }),
      OPENAI_MODEL: envField.string({ context: 'server', access: 'secret', optional: true, default: 'gpt-4o-mini' }),
      DEFAULT_LEAGUE: envField.number({ context: 'server', access: 'secret', optional: true, default: 39 }),
      DEFAULT_SEASON: envField.number({ context: 'server', access: 'secret', optional: true, default: 2024 }),
    },
  },
});
