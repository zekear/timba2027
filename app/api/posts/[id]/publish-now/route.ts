import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../src/db/client.js';
import { botPosts } from '../../../../../src/db/schema.js';
import { approveDraft, schedulePost } from '../../../../../src/publish/transitions.js';

/**
 * Approve + schedule en una sola request — bypasea el delay de soft-launch.
 * El publisher worker hará el publish en su próximo tick.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return new NextResponse('Bad id', { status: 400 });
  try {
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
    if (!p) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    if (p.status === 'draft') await approveDraft(numId);
    if (p.status === 'approved' || p.status === 'draft') await schedulePost(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
