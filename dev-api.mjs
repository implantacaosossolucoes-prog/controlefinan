import { randomUUID } from 'node:crypto';

const collections = new Set(['config', 'lancamentos', 'contas', 'vacas', 'bezerros']);
const users = new Set(['gabriel', 'alipio']);
const cookieName = 'cf_demo_session';
const sessions = new Map();
const records = new Map([...collections].map(name => [name, new Map()]));
const calfPhotos = new Map();
const password = process.env.LOCAL_DEMO_PASSWORD || 'teste123';

function send(response, status, payload, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(payload));
}

async function parseBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error('A solicitação excedeu o limite permitido.'), { statusCode: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { statusCode: 400 });
  }
}

function sessionFor(request) {
  const token = (request.headers.cookie || '').split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  return token ? sessions.get(token) : null;
}

function cookie(value, maxAge, secure) {
  const secureFlag = secure ? '; Secure' : '';
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`;
}

function calfPhotoKey(id, kind) {
  return `${id}:${kind}`;
}

export default async function devApiHandler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const route = url.pathname.split('/').filter(Boolean).at(-1);
  const secure = request.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';

  try {
    if (request.method === 'POST' && route === 'login') {
      const body = await parseBody(request);
      if (!users.has(body.username) || typeof body.password !== 'string' || body.password !== password) {
        return send(response, 401, { error: 'Usuário ou senha inválidos.' });
      }
      const token = randomUUID();
      sessions.set(token, body.username);
      return send(response, 200, { username: body.username }, {
        'Set-Cookie': cookie(token, 86400, secure)
      });
    }

    if (request.method === 'POST' && route === 'logout') {
      const token = (request.headers.cookie || '').split(';')
        .map(value => value.trim())
        .find(value => value.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      if (token) sessions.delete(token);
      return send(response, 200, { ok: true }, { 'Set-Cookie': cookie('', 0, secure) });
    }

    if (request.method === 'GET' && route === 'session') {
      const username = sessionFor(request);
      return username
        ? send(response, 200, { username })
        : send(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
    }

    if (!sessionFor(request)) return send(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });

    if (route === 'calf-photos') {
      const calfId = url.searchParams.get('calfId');
      const kind = url.searchParams.get('kind');
      if (!calfId || !['animal', 'tag'].includes(kind)) return send(response, 400, { error: 'Identificação da foto inválida.' });
      const calf = records.get('bezerros').get(calfId);
      if (!calf) return send(response, 404, { error: 'Bezerro não encontrado.' });
      const key = calfPhotoKey(calfId, kind);
      const field = kind === 'animal' ? 'photoAnimal' : 'photoTag';

      if (request.method === 'POST') {
        const body = await parseBody(request);
        if (typeof body.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) {
          return send(response, 400, { error: 'A imagem enviada é inválida.' });
        }
        const image = Buffer.from(body.image, 'base64');
        if (!image.length || image.length > 700_000 || image.toString('base64') !== body.image) {
          return send(response, 413, { error: 'A foto excede o limite de tamanho.' });
        }
        if (image.subarray(0, 3).toString('hex') !== 'ffd8ff') return send(response, 400, { error: 'Envie uma foto válida em formato JPEG.' });
        calfPhotos.set(key, image);
        records.get('bezerros').set(calfId, { ...calf, [field]: true });
        return send(response, 200, { saved: true });
      }

      if (request.method === 'GET') {
        const image = calfPhotos.get(key);
        if (!calf[field] || !image) return send(response, 404, { error: 'Foto não cadastrada.' });
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/jpeg');
        response.setHeader('Cache-Control', 'private, no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(image);
        return;
      }

      return send(response, 405, { error: 'Método não permitido.' }, { Allow: 'GET, POST' });
    }

    const collection = url.searchParams.get('collection');
    const id = url.searchParams.get('id');
    if (collection && !collections.has(collection)) return send(response, 400, { error: 'Coleção inválida.' });

    if (request.method === 'GET' && route === 'records') {
      const selected = collection ? [collection] : [...collections];
      return send(response, 200, selected.flatMap(name =>
        [...records.get(name)].map(([recordId, data]) => ({ ...data, id: recordId, collection: name }))
      ));
    }

    if (request.method === 'POST' && route === 'records') {
      const body = await parseBody(request);
      if (!collections.has(body.collection) || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        return send(response, 400, { error: 'Registro inválido.' });
      }
      const newId = randomUUID();
      records.get(body.collection).set(newId, body.data);
      return send(response, 201, { id: newId });
    }

    if (request.method === 'PUT' && route === 'records') {
      const body = await parseBody(request);
      if (!collection || !id || !collections.has(collection)
        || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        return send(response, 400, { error: 'Registro inválido.' });
      }
      records.get(collection).set(id, body.data);
      return send(response, 200, { id });
    }

    if (request.method === 'DELETE' && route === 'records') {
      if (!collection || !id || !collections.has(collection)) return send(response, 400, { error: 'Registro inválido.' });
      if (collection === 'bezerros') {
        calfPhotos.delete(calfPhotoKey(id, 'animal'));
        calfPhotos.delete(calfPhotoKey(id, 'tag'));
      }
      records.get(collection).delete(id);
      return send(response, 200, { ok: true });
    }

    return send(response, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    console.error('Local demo API request failed:', error);
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return send(response, status, { error: status === 500 ? 'Não foi possível concluir a operação.' : error.message });
  }
}
