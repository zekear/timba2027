import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  // Solo permitir paths simples que no escapen storage/cards/
  if (file.includes('..') || file.includes('/')) {
    return new NextResponse('Bad Request', { status: 400 });
  }
  try {
    const buf = await readFile(resolve(process.cwd(), 'storage/cards', file));
    return new NextResponse(buf, {
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60' },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
