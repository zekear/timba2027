import { NextResponse } from 'next/server';
import { approveDraft } from '../../../../../src/publish/transitions.js';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return new NextResponse('Bad id', { status: 400 });
  try {
    await approveDraft(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
