import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith('/_next/') || path === '/favicon.ico') {
    return NextResponse.next();
  }

  const expectedUser = process.env.ADMIN_BASIC_AUTH_USER;
  const expectedPass = process.env.ADMIN_BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) {
    return new NextResponse(
      'ADMIN_BASIC_AUTH_USER y ADMIN_BASIC_AUTH_PASS no están seteadas. Configurar en .env.',
      { status: 503 },
    );
  }

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="politica-admin"' },
    });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  const [user, pass] = decoded.split(':');
  if (user !== expectedUser || pass !== expectedPass) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="politica-admin"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
