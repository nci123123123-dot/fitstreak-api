import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';

import authPlugin   from './plugins/auth.plugin';
import { StreakService }  from './services/streak.service';
import { authRoutes }    from './routes/auth.route';
import { workoutRoutes } from './routes/workout.route';
import { socialRoutes }  from './routes/social.route';
import { placesRoutes }  from './routes/places.route';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  const prisma = new PrismaClient();
  const streakService = new StreakService(prisma);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  // Plugins
  await app.register(cors, { origin: true });
  await app.register(authPlugin);

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

  // Routes
  await app.register(fp(async (instance) => {
    await authRoutes(instance, { prisma });
    await workoutRoutes(instance, { prisma, streakService });
    await socialRoutes(instance, { prisma });
    await placesRoutes(instance);
  }));

  return app;
}
