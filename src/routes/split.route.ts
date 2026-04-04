import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

export interface SplitSlot {
  label: string; // e.g. "등, 이두"
}

export interface SplitConfig {
  slots:            SplitSlot[];
  currentSlotIndex: number;
}

export async function splitRoutes(
  app: FastifyInstance,
  { prisma }: { prisma: PrismaClient },
) {
  // GET /users/me/split — 현재 분할 설정 + 오늘 할 운동 슬롯 반환
  app.get('/users/me/split', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { splitConfig: true },
    });

    if (!user?.splitConfig) {
      return reply.send({ config: null, todaySlot: null, todaySlotIndex: null });
    }

    const config: SplitConfig = JSON.parse(user.splitConfig);
    const todaySlot = config.slots.length > 0
      ? config.slots[config.currentSlotIndex % config.slots.length]
      : null;

    return reply.send({
      config,
      todaySlot,
      todaySlotIndex: config.currentSlotIndex % config.slots.length,
    });
  });

  // PUT /users/me/split — 분할 설정 저장 (슬롯 변경 시 인덱스 유지, null이면 초기화)
  app.put<{
    Body: { slots: SplitSlot[] | null };
  }>('/users/me/split', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['slots'],
        properties: {
          slots: {
            oneOf: [
              { type: 'null' },
              {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['label'],
                  properties: { label: { type: 'string', maxLength: 100 } },
                },
                maxItems: 7,
              },
            ],
          },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const { slots } = req.body;

    if (!slots || slots.length === 0) {
      // 분할 설정 해제
      await prisma.user.update({
        where:  { id: userId },
        data:   { splitConfig: null },
      });
      return reply.send({ config: null });
    }

    // 기존 인덱스 유지 (분할 수가 바뀌어도 범위 내로 clamp)
    const existing = await prisma.user.findUnique({
      where:  { id: userId },
      select: { splitConfig: true },
    });
    const prevIndex = existing?.splitConfig
      ? (JSON.parse(existing.splitConfig) as SplitConfig).currentSlotIndex
      : 0;

    const config: SplitConfig = {
      slots,
      currentSlotIndex: prevIndex % slots.length,
    };

    await prisma.user.update({
      where: { id: userId },
      data:  { splitConfig: JSON.stringify(config) },
    });

    return reply.send({ config });
  });
}

// 운동 기록 후 슬롯 자동 전진 (workout.route.ts에서 호출)
export async function advanceSplitSlot(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { splitConfig: true },
  });
  if (!user?.splitConfig) return;

  const config: SplitConfig = JSON.parse(user.splitConfig);
  config.currentSlotIndex = (config.currentSlotIndex + 1) % config.slots.length;

  await prisma.user.update({
    where: { id: userId },
    data:  { splitConfig: JSON.stringify(config) },
  });
}
