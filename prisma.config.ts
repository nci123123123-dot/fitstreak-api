import path from 'path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: path.join('prisma', 'schema.prisma'),
  migrate: {
    async adapter() {
      const { PrismaLibSQL } = await import('@prisma/adapter-libsql');
      const { createClient } = await import('@libsql/client');
      const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
      const client = createClient({ url: dbUrl });
      return new PrismaLibSQL(client);
    },
  },
});
