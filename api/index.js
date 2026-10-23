import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { validRecordId, validateRecordData, validateRestoreRecords } from '../shared/data.js';

const collections = new Set(['config', 'lancamentos', 'contas', 'vacas', 'bezerros']);
const cookieName = 'cf_session';
const sessionDuration = 7 * 24 * 60 * 60;
const photoBucket = 'animal-photos';
const calfPhotoKinds = new Set(['animal', 'tag']);

function send(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(payload));
}

async function parseBody(request, maxBytes = 1_000_000) {
  if ('body' in request) {
    if (request.body && typeof request.body === 'object') {
      if (Buffer.byteLength(JSON.stringify(request.body)) > maxBytes) {
        throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
      }
      return request.body;
    }
    if (typeof request.body !== 'string') return {};
    if (Buffer.byteLength(request.body) > maxBytes) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    try {
      return JSON.parse(request.body || '{}');
    } catch {
      throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
    }
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

async function parseImageBody(request, maxBytes = 700_000) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (request.body instanceof Uint8Array) return Buffer.from(request.body);
  if (request.body instanceof ArrayBuffer) return Buffer.from(request.body);
  if (typeof request.body === 'string') return Buffer.from(request.body, 'binary');
  if (request.body !== undefined && request.body !== null) {
    throw Object.assign(new Error('Invalid image body'), { statusCode: 400 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
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
  const endpoint = path.startsWith('/rpc/') || path.startsWith('/deletion_audit') || path.startsWith('/activity_logs')
    ? `${url}/rest/v1${path}`
    : `${url}/rest/v1/records${path}`;
  const response = await fetch(endpoint, {
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
        { publicMessage: 'Uma tabela necessária ao app não existe no Supabase. Execute o arquivo supabase/schema.sql no SQL Editor.' }
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

async function supabaseStorageRequest(path, options = {}) {
  const { url, key } = getSupabaseConfig();
  const headers = { apikey: key, ...options.headers };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${url}/storage/v1${path}`, { ...options, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const errorCode = typeof detail.error === 'string' ? detail.error : '';
    console.error('Supabase Storage request failed', { status: response.status, error: errorCode });
    if (response.status === 404) {
      if (options.method === 'GET' && path.startsWith(`/object/${photoBucket}/`)) {
        throw Object.assign(new Error('Calf photo is missing'), { statusCode: 404 });
      }
      throw Object.assign(new Error('Supabase Storage bucket is missing'), {
        publicMessage: 'O bucket animal-photos não existe. Execute novamente supabase/schema.sql no SQL Editor do Supabase.'
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error('Supabase Storage rejected the server key'), {
        publicMessage: 'O Supabase Storage recusou a chave do servidor. Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.'
      });
    }
    throw Object.assign(new Error(`Supabase Storage request failed with HTTP ${response.status}`), {
      publicMessage: `Não foi possível acessar o armazenamento de fotos (HTTP ${response.status}). Confira o bucket animal-photos e as credenciais do Supabase.`
    });
  }
  return response;
}

function validCalfId(value) {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

function calfPhotoKey(id, kind) {
  return `bezerros/${id}/${kind}.jpg`;
}

async function getCalfData(id) {
  const query = new URLSearchParams({ select: 'data', collection: 'eq.bezerros', id: `eq.${id}` });
  const rows = await supabaseRequest(`?${query}`);
  return rows[0]?.data || null;
}

function sendPhoto(response, image) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'image/jpeg');
  response.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(Buffer.from(image));
}

async function removeCalfPhotos(id) {
  const prefixes = [...calfPhotoKinds].map(kind => calfPhotoKey(id, kind));
  const path = `/object/${photoBucket}`;
  await supabaseStorageRequest(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes })
  });
}

function validCollection(value) {
  return typeof value === 'string' && collections.has(value);
}

async function writeActivityLogs(username, events) {
  await supabaseRequest('/rpc/write_activity_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ p_username: username, p_events: events })
  });
}

export default async function handler(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const params = new URL(request.url, 'http://localhost').searchParams;
  const route = params.get('route') || pathname.split('/').filter(Boolean).at(-1);

  try {
    const allowedMethods = {
      login: ['POST'],
      logout: ['POST'],
      session: ['GET'],
      records: ['GET', 'POST', 'PUT', 'DELETE'],
      deletions: ['GET'],
      activity: ['GET', 'POST'],
      restore: ['POST'],
      'pay-bill': ['POST'],
      'calf-photos': ['GET', 'POST']
    };
    if (allowedMethods[route] && !allowedMethods[route].includes(request.method)) {
      return send(response, 405, { error: 'Método não permitido.' }, { Allow: allowedMethods[route].join(', ') });
    }

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
      await writeActivityLogs(username, [{ type: 'login', target: 'login' }]);
      const token = makeSession(username);
      return send(response, 200, { username }, {
        'Set-Cookie': cookie(token, sessionDuration, request)
      });
    }

    if (request.method === 'POST' && route === 'logout') {
      const session = getSession(request);
      if (session) await writeActivityLogs(session.username, [{ type: 'logout', target: 'logout' }]);
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

    if (route === 'activity') {
      if (request.method === 'POST') {
        const body = await parseBody(request);
        if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 100
          || body.events.some(event => !event || typeof event !== 'object' || Array.isArray(event)
            || !['click', 'change'].includes(event.type)
            || typeof event.target !== 'string' || !event.target.trim() || event.target.length > 250
            || (event.field !== undefined && (typeof event.field !== 'string'
              || !event.field.trim() || event.field.length > 120)))) {
          return send(response, 400, { error: 'O lote de atividades contém eventos inválidos.' });
        }
        const events = body.events.map(event => ({
          type: event.type,
          target: event.target.trim(),
          ...(event.field ? { field: event.field.trim() } : {})
        }));
        await writeActivityLogs(session.username, events);
        return send(response, 200, { logged: events.length });
      }
      if (session.username !== 'alipio') {
        return send(response, 403, { error: 'Somente o usuário Alipio pode consultar os logs.' });
      }
      const query = new URLSearchParams({
        select: 'id,username,event_type,target,field_name,created_at',
        order: 'created_at.desc,id.desc',
        limit: '1000'
      });
      const entries = await supabaseRequest(`/activity_logs?${query}`);
      return send(response, 200, entries);
    }

    if (route === 'deletions') {
      if (request.method !== 'GET') {
        return send(response, 405, { error: 'Método não permitido.' }, { Allow: 'GET' });
      }
      if (session.username !== 'alipio') {
        return send(response, 403, { error: 'Somente o usuário Alipio pode consultar as exclusões.' });
      }
      const query = new URLSearchParams({
        select: 'id,collection,record_id,record_data,reason,deleted_by,deleted_at',
        order: 'deleted_at.desc,id.desc',
        limit: '500'
      });
      const entries = await supabaseRequest(`/deletion_audit?${query}`);
      return send(response, 200, entries);
    }

    if (route === 'restore') {
      const body = await parseBody(request, 4_000_000);
      let records;
      try {
        records = validateRestoreRecords(body.records);
      } catch {
        return send(response, 400, { error: 'O backup contém registros inválidos ou identificadores duplicados.' });
      }
      await supabaseRequest('/rpc/restore_records', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ p_records: records })
      });
      return send(response, 200, { restored: records.length });
    }

    if (route === 'pay-bill') {
      const body = await parseBody(request);
      const { id, who, date } = body;
      const movementId = randomUUID();
      if (!validRecordId(id)
        || validateRecordData('lancamentos', movementId, {
          type: 'out', value: 1, desc: '', cat: 'Contas a pagar', date, who
        })) {
        return send(response, 400, { error: 'Dados de pagamento inválidos.' });
      }
      await supabaseRequest('/rpc/pay_bill', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          p_bill_id: id,
          p_movement_id: movementId,
          p_who: who,
          p_date: date,
          p_deleted_by: session.username
        })
      });
      return send(response, 200, { id: movementId });
    }

    if (route === 'calf-photos') {
      const calfId = params.get('calfId');
      const kind = params.get('kind');
      if (!validCalfId(calfId) || !calfPhotoKinds.has(kind)) {
        return send(response, 400, { error: 'Identificação da foto inválida.' });
      }
      const field = kind === 'animal' ? 'photoAnimal' : 'photoTag';
      const key = calfPhotoKey(calfId, kind);

      if (request.method === 'POST') {
        const data = await getCalfData(calfId);
        if (!data) return send(response, 404, { error: 'Bezerro não encontrado.' });
        if (request.headers['content-type'] !== 'image/jpeg') {
          return send(response, 400, { error: 'A imagem enviada é inválida.' });
        }
        const image = await parseImageBody(request);
        if (!image.length || image.length > 700_000) {
          return send(response, 413, { error: 'A foto excede o limite de tamanho. Tente capturar uma imagem menor.' });
        }
        const signature = image.subarray(0, 3).toString('hex');
        if (signature !== 'ffd8ff') return send(response, 400, { error: 'Envie uma foto válida em formato JPEG.' });
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        await supabaseStorageRequest(`/object/${photoBucket}/${encodedKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
          body: image
        });
        const version = randomUUID();
        return send(response, 200, { saved: true, field, version });
      }

      if (request.method === 'GET') {
        const data = await getCalfData(calfId);
        if (!data || !data[field]) return send(response, 404, { error: 'Foto não cadastrada.' });
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        const photo = await supabaseStorageRequest(`/object/${photoBucket}/${encodedKey}`);
        const image = Buffer.from(await photo.arrayBuffer());
        return sendPhoto(response, image);
      }

      return send(response, 405, { error: 'Método não permitido.' }, { Allow: 'GET, POST' });
    }

    const body = ['POST', 'PUT', 'DELETE'].includes(request.method) ? await parseBody(request) : {};
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
      const newId = randomUUID();
      if (validateRecordData(collection, newId, data)) return send(response, 400, { error: 'Registro inválido.' });
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
      if (validateRecordData(collection, id, data)) {
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
      if (!validRecordId(id)) {
        return send(response, 400, { error: 'Registro inválido.' });
      }
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason || reason.length > 1000 || reason.includes('\0')) {
        return send(response, 400, { error: 'Informe uma justificativa de até 1.000 caracteres para excluir o registro.' });
      }
      await supabaseRequest('/rpc/delete_record', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          p_collection: collection,
          p_record_id: id,
          p_reason: reason,
          p_deleted_by: session.username
        })
      });
      if (collection === 'bezerros' && validCalfId(id)) {
        try {
          await removeCalfPhotos(id);
        } catch {
          throw Object.assign(new Error('Calf was deleted but its photos could not be removed'), {
            publicMessage: 'O bezerro foi excluído e a justificativa foi registrada, mas não foi possível remover as fotos. Confira o armazenamento do Supabase.'
          });
        }
      }
      return send(response, 200, { ok: true });
    }

    if (route === 'records') return send(response, 405, { error: 'Método não permitido.' }, { Allow: 'GET, POST, PUT, DELETE' });
    return send(response, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    console.error('API request failed:', error);
    if (error.statusCode) return send(response, error.statusCode, { error: error.statusCode === 413 ? 'A solicitação excedeu o limite permitido.' : error.statusCode === 404 ? 'Foto não cadastrada.' : 'Solicitação inválida.' });
    if (error.publicMessage) return send(response, 500, { error: error.publicMessage });
    const message = error.publicMessage || (error.message.includes('environment variables') || error.message.includes('APP_SESSION_SECRET')
      || error.message.includes('APP_PASSWORD')
      ? 'O backend ainda não está configurado. Confira as variáveis de ambiente do Vercel.'
      : 'Não foi possível concluir a operação. Tente novamente.');
    return send(response, 500, { error: message });
  }
}
