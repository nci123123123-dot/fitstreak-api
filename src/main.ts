import { buildApp } from './app';

async function main() {
  const app = await buildApp();
  const port = parseInt(process.env.PORT ?? '3000');

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`\n🏋️  FitStreak API running at http://localhost:${port}\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
