import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const collections = new Set(['config', 'lancamentos', 'contas', 'vacas']);
const cookieName = 'cf_session';
const sessionDuration = 7 * 24 * 60 * 60;

function send(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(payload));
}

async function parseBody(request) {
  if ('body' in request) {
    if (request.body && typeof request.body === 'object') return request.body;
    if (typeof request.body !== 'string') return {};
    try {
      return JSON.parse(request.body || '{}');
    } catch {
      throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
    }
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

function sessionSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('APP_SESSION_SECRET must contain at least 32 bytes');
  }
  return secret;
}

function makeSession(username) {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Math.floor(Date.now() / 1000) + sessionDuration
  })).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getSession(request) {
  const cookies = (request.headers.cookie || '').split(';');
  const token = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return null;

  const [payload, signature, ...extra] = token.split('.');
  if (!payload || !signature || extra.length) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return ['gabriel', 'alipio'].includes(session.username)
      && Number.isInteger(session.expiresAt)
      && session.expiresAt > Math.floor(Date.now() / 1000)
      ? session
      : null;
  } catch {
    return null;
  }
}

function cookie(value, maxAge, request) {
  const forwardedProto = request.headers['x-forwarded-proto']?.split(',')[0].trim();
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production' || forwardedProto === 'https'
    ? '; Secure'
    : '';
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function verifyPassword(username, password) {
  const envName = username === 'gabriel' ? 'APP_PASSWORD_GABRIEL' : 'APP_PASSWORD_ALIPIO';
  const expected = process.env[envName];
  if (!expected || Buffer.byteLength(expected) < 4 || typeof password !== 'string' || password.length < 4) return false;
  const providedBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function getSupabaseConfig() {
  const configuredUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configuredUrl || !key) throw new Error('Supabase server environment variables are not configured');
  let projectUrl;
  try {
    projectUrl = new URL(configuredUrl);
  } catch {
    throw Object.assign(new Error('Invalid Supabase project URL'), {
      publicMessage: 'SUPABASE_URL precisa ser a URL do projeto Supabase (https://<projeto>.supabase.co), sem caminhos como /dashboard ou /project.'
    });
  }
  if (!['https:', 'http:'].includes(projectUrl.protocol) || projectUrl.search || projectUrl.hash) {
    throw Object.assign(new Error('Invalid Supabase project URL'), {
      publicMessage: 'SUPABASE_URL precisa ser a URL base do projeto Supabase, sem parâmetros ou fragmentos.'
    });
  }
  const path = projectUrl.pathname.replace(/\/+$/, '');
  if (path && path !== '/rest/v1') {
    throw Object.assign(new Error('Invalid Supabase project URL path'), {
      publicMessage: 'SUPABASE_URL deve ser a URL base do projeto Supabase, sem caminhos como /dashboard ou /project.'
    });
  }
  projectUrl.pathname = '';
  projectUrl.search = '';
  projectUrl.hash = '';
  return { url: projectUrl.origin, key };
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = getSupabaseConfig();
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (!key.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${key}`;
  }
  const response = await fetch(`${url}/rest/v1/records${path}`, {
    ...options,
    headers
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const code = typeof detail.code === 'string' ? detail.code : '';
    console.error('Supabase request failed', { status: response.status, code });
    if (code === 'PGRST125') {
      throw Object.assign(new Error('Supabase rejected an invalid API path'), {
        publicMessage: 'O Supabase recebeu um caminho inválido. No Vercel, defina SUPABASE_URL como a URL base exibida em Project Settings → API, sem /rest/v1 no final.'
      });
    }
    if (['PGRST205', '42P01'].includes(code)) {
      throw Object.assign(
        new Error('Supabase table is missing'),
        { publicMessage: 'A tabela records não existe no Supabase. Execute o arquivo supabase/schema.sql no SQL Editor.' }
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(
        new Error('Supabase rejected the server key'),
        { publicMessage: 'O Supabase recusou a chave. Confira se SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY pertencem ao mesmo projeto e se a chave é Secret (sb_secret_) ou service_role.' }
      );
    }
    throw Object.assign(
      new Error(`Supabase request failed with HTTP ${response.status} ${code}`),
      { publicMessage: `O Supabase recusou a operação (HTTP ${response.status}${code ? `, ${code}` : ''}). Confira se a tabela records e o schema foram configurados.` }
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function validCollection(value) {
  return typeof value === 'string' && collections.has(value);
}

export default async function handler(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const params = new URL(request.url, 'http://localhost').searchParams;
  const route = params.get('route') || pathname.split('/').filter(Boolean).at(-1);

  try {
    if (request.method === 'POST' && route === 'login') {
      sessionSecret();
      getSupabaseConfig();
      if (Buffer.byteLength(process.env.APP_PASSWORD_GABRIEL || '') < 4
        || Buffer.byteLength(process.env.APP_PASSWORD_ALIPIO || '') < 4) {
        throw new Error('App password environment variables are not configured');
      }
      const { username, password } = await parseBody(request);
      if (!['gabriel', 'alipio'].includes(username) || !verifyPassword(username, password)) {
        return send(response, 401, { error: 'Usuário ou senha inválidos.' });
      }
      const token = makeSession(username);
      return send(response, 200, { username }, {
        'Set-Cookie': cookie(token, sessionDuration, request)
      });
    }

    if (request.method === 'POST' && route === 'logout') {
      return send(response, 200, { ok: true }, { 'Set-Cookie': cookie('', 0, request) });
    }

    if (request.method === 'GET' && route === 'session') {
      const session = getSession(request);
      return session
        ? send(response, 200, { username: session.username })
        : send(response, 401, { error: 'Authentication required' });
    }

    const session = getSession(request);
    if (!session) return send(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });

    const body = ['POST', 'PUT'].includes(request.method) ? await parseBody(request) : {};
    const collection = params.get('collection') || (request.method === 'POST' ? body.collection : null);
    const id = params.get('id');
    if (collection !== null && !validCollection(collection)) return send(response, 400, { error: 'Coleção inválida.' });

    if (request.method === 'GET' && route === 'records') {
      const query = new URLSearchParams({ select: 'collection,id,data' });
      if (collection) query.set('collection', `eq.${collection}`);
      const rows = await supabaseRequest(`?${query}`);
      return send(response, 200, rows.map(row => ({ ...row.data, id: row.id, collection: row.collection })));
    }

    if (request.method === 'POST' && route === 'records') {
      if (!validCollection(collection)) return send(response, 400, { error: 'Coleção inválida.' });
      const { data } = body;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send(response, 400, { error: 'Registro inválido.' });
      const newId = randomUUID();
      await supabaseRequest('', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ collection, id: newId, data })
      });
      return send(response, 201, { id: newId });
    }

    if (request.method === 'PUT' && route === 'records') {
      if (!validCollection(collection)) return send(response, 400, { error: 'Coleção inválida.' });
      const { data } = body;
      if (!id || !data || typeof data !== 'object' || Array.isArray(data)) {
        return send(response, 400, { error: 'Registro inválido.' });
      }
      const query = new URLSearchParams({ on_conflict: 'collection,id' });
      await supabaseRequest(`?${query}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ collection, id, data })
      });
      return send(response, 200, { id });
    }

    if (request.method === 'DELETE' && route === 'records') {
      if (!validCollection(collection)) return send(response, 400, { error: 'Coleção inválida.' });
      if (!id) return send(response, 400, { error: 'Registro inválido.' });
      const query = new URLSearchParams({ collection: `eq.${collection}`, id: `eq.${id}` });
      await supabaseRequest(`?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return send(response, 200, { ok: true });
    }

    return send(response, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    console.error('API request failed:', error);
    if (error.statusCode) return send(response, error.statusCode, { error: error.statusCode === 413 ? 'A solicitação excedeu o limite permitido.' : 'Solicitação inválida.' });
    if (error.publicMessage) return send(response, 500, { error: error.publicMessage });
    const message = error.publicMessage || (error.message.includes('environment variables') || error.message.includes('APP_SESSION_SECRET')
      || error.message.includes('APP_PASSWORD')
      ? 'O backend ainda não está configurado. Confira as variáveis de ambiente do Vercel.'
      : 'Não foi possível concluir a operação. Tente novamente.');
    return send(response, 500, { error: message });
  }
}
