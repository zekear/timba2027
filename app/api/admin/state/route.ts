import { NextResponse } from 'next/server';
import { db } from '../../../../src/db/client.js';
import { adminState } from '../../../../src/db/schema.js';

const KEYS = ['kill_switch', 'publish_mode'] as const;

export async function GET(): Promise<NextResponse> {
  const rows = await db.select().from(adminState);
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  // Defaults si la fila no existe todavía
  result.kill_switch = result.kill_switch ?? 'false';
  result.publish_mode = result.publish_mode ?? process.env.PUBLISH_MODE ?? 'shadow';
  return NextResponse.json(result);
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { key?: string; value?: string };
  if (!body.key || !KEYS.includes(body.key as (typeof KEYS)[number])) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }
  if (typeof body.value !== 'string') {
    return NextResponse.json({ error: 'invalid value' }, { status: 400 });
  }
  if (body.key === 'publish_mode' && !['shadow', 'soft', 'full'].includes(body.value)) {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  }
  if (body.key === 'kill_switch' && !['true', 'false'].includes(body.value)) {
    return NextResponse.json({ error: 'invalid bool' }, { status: 400 });
  }

  await db
    .insert(adminState)
    .values({ key: body.key, value: body.value })
    .onConflictDoUpdate({
      target: adminState.key,
      set: { value: body.value, updatedAt: new Date() },
    });
  return NextResponse.json({ ok: true });
}
