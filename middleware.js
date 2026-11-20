import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { next } from '@vercel/functions';

const LOGIN_PATH = '/_knight/access';
const COOKIE_NAME = '__Host-knight-access';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function signExpiry(expiry, password) {
  return createHmac('sha256', password)
    .update(`knight-access-session:v1:${expiry}`)
    .digest();
}

function hasSession(request, password) {
  const cookies = request.headers.get('cookie') || '';
  const cookie = cookies.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`));
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(cookie?.slice(COOKIE_NAME.length + 1) || '');

  if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  const signature = Buffer.from(match[2], 'base64url');
  return timingSafeEqual(signature, signExpiry(match[1], password));
}

function passwordPage(request, wrongPassword = false) {
  return new Response(request.method === 'HEAD' ? null : `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>访问骑士 Knight</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; min-height: 100svh; margin: 0; padding: 24px; display: grid; place-items: center; background: #141816; color: #faf3e6; }
    main { width: min(100%, 400px); padding: clamp(24px, 7vw, 40px); border: 1px solid #39443e; border-radius: 18px; background: #1c251f; }
    .brand { color: #f2b976; font-size: 14px; font-weight: 750; letter-spacing: .09em; }
    h1 { margin: 10px 0 25px; font-size: clamp(25px, 7vw, 33px); line-height: 1.25; }
    label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 600; }
    input, button { display: block; width: 100%; min-height: 46px; padding: 10px 14px; border-radius: 8px; font: inherit; }
    input { border: 1px solid #606b63; background: #131a16; color: inherit; }
    input[aria-invalid="true"] { border-color: #ffb5a5; }
    button { margin-top: 16px; border: 0; background: #f2b976; color: #251b11; font-weight: 750; cursor: pointer; }
    input:focus-visible, button:focus-visible { outline: 2px solid #fff0d9; outline-offset: 2px; }
    .error { margin: 10px 0 0; color: #ffb5a5; font-size: 14px; }
    @media (prefers-reduced-motion: no-preference) {
      input[aria-invalid="true"] { animation: password-shake 420ms ease-out; }
      @keyframes password-shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-8px); }
        40% { transform: translateX(8px); }
        60% { transform: translateX(-5px); }
        80% { transform: translateX(3px); }
      }
    }
  </style>
</head>
<body>
  <main>
    <span class="brand">骑士 KNIGHT</span>
    <h1>输入密码访问</h1>
    <form method="post" action="${LOGIN_PATH}">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password"
        maxlength="256" required ${wrongPassword ? 'aria-invalid="true" aria-describedby="error"' : ''}>
      ${wrongPassword ? '<p class="error" id="error" role="alert">密码不正确，请再试一次。</p>' : ''}
      <button type="submit">进入骑士</button>
    </form>
  </main>
</body>
</html>`, {
    status: 401,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export default async function proxy(request) {
  const password = process.env.KNIGHT_SITE_PASSWORD;
  if (!password) {
    return new Response(request.method === 'HEAD' ? null : '访问保护暂不可用，请稍后再试。', {
      status: 503,
      headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === LOGIN_PATH) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) {
      return new Response(null, { status: 403, headers: PRIVATE_HEADERS });
    }
    const form = await request.formData().catch(() => null);
    const submitted = form?.get('password');
    if (typeof submitted !== 'string' || submitted.length > 256 ||
        !timingSafeEqual(hash(submitted), hash(password))) {
      return passwordPage(request, true);
    }

    const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const session = `${expiry}.${signExpiry(expiry, password).toString('base64url')}`;
    return new Response(null, {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        'Location': '/',
        'Set-Cookie': `${COOKIE_NAME}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Lax`
      }
    });
  }

  return hasSession(request, password)
    ? next({ headers: PRIVATE_HEADERS })
    : passwordPage(request);
}

export const config = { runtime: 'nodejs' };
