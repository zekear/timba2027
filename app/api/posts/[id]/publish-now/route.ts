import { NextResponse } from 'next/server';
import { publishOneNow } from '../../../../../src/publish/publisher.js';

/**
 * "Publish now": aprueba (si está en draft), schedulea y publica YA a X,
 * bypassing window/mode pero respetando kill switch.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return new NextResponse('Bad id', { status: 400 });
  const result = await publishOneNow(numId);
  if (result.ok) {
    return NextResponse.json({ ok: true, xPostId: result.xPostId });
  }
  const status = result.reason === 'not_found' ? 404 : 400;
  return NextResponse.json({ ok: false, error: result.reason }, { status });
}
