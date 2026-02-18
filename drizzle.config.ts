import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'turso',
  schema: ['./src/server/db/schema/*.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db',
    authToken: process.env.TURSO_DB_AUTH_TOKEN,
  },
});
