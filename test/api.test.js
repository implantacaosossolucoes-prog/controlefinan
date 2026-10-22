import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.js';

const originalEnvironment = {
  APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
  APP_PASSWORD_GABRIEL: process.env.APP_PASSWORD_GABRIEL,
  APP_PASSWORD_ALIPIO: process.env.APP_PASSWORD_ALIPIO,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
};

process.env.APP_SESSION_SECRET = 'test-only-session-secret-longer-than-32-bytes';
process.env.APP_PASSWORD_GABRIEL = 'secret-gabriel';
process.env.APP_PASSWORD_ALIPIO = 'secret-alipio';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-key';

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
    json() { return JSON.parse(this.body); }
  };
}

async function request(method, url, body, cookie = '', headers = {}) {
  const req = { method, url, body, headers: { cookie, ...headers } };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

async function loginCookie() {
  const response = await request('POST', '/api/login', {
    username: 'gabriel',
    password: 'secret-gabriel'
  });
  assert.equal(response.statusCode, 200);
  return response.headers['set-cookie'].split(';')[0];
}

test('production data routes require a signed-in session', async () => {
  const response = await request('GET', '/api/records');
  assert.equal(response.statusCode, 401);
});

test('photo downloads require a session and matching calf photo metadata', async () => {
  const calfId = '123e4567-e89b-42d3-a456-426614174000';
  const url = `/api/calf-photos?calfId=${calfId}&kind=animal`;
  const anonymousResponse = await request('GET', url);
  assert.equal(anonymousResponse.statusCode, 401);

  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async target => {
    calls.push(String(target));
    if (calls.length === 1) {
      return new Response(JSON.stringify([{ data: { photoAnimal: true } }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' }
    });
  };
  try {
    const response = await request('GET', url, undefined, cookie);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/jpeg');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /collection=eq\.bezerros/);
    assert.match(calls[1], /\/storage\/v1\/object\/animal-photos\//);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('photo access is denied if the calf record no longer exists', async () => {
  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await request(
      'GET',
      '/api/calf-photos?calfId=123e4567-e89b-42d3-a456-426614174000&kind=animal',
      undefined,
      cookie
    );
    assert.equal(response.statusCode, 404);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('restore sends one validated batch request to the transactional RPC', async () => {
  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };
  try {
    const records = [
      { collection: 'config', id: 'saldo', data: { value: 500 } },
      { collection: 'lancamentos', id: 'movement-1', data: { type: 'in', value: 50, date: '2026-01-10' } }
    ];
    const response = await request('POST', '/api/restore', { records }, cookie);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { restored: 2 });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/restore_records$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), { p_records: records });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('restore rejects duplicate IDs before contacting Supabase', async () => {
  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    const record = { collection: 'config', id: 'saldo', data: { value: 500 } };
    const response = await request('POST', '/api/restore', { records: [record, record] }, cookie);
    assert.equal(response.statusCode, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('restore enforces the request-size limit before contacting Supabase', async () => {
  const cookie = await loginCookie();
  const previousError = console.error;
  console.error = () => {};
  try {
    const response = await request('POST', '/api/restore', {
      records: [],
      oversized: 'x'.repeat(4_000_000)
    }, cookie);
    assert.equal(response.statusCode, 413);
  } finally {
    console.error = previousError;
  }
});

test('record writes reject HTML-capable identifiers before reaching Supabase', async () => {
  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };
  try {
    const response = await request(
      'PUT',
      `/api/records?collection=contas&id=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`,
      { data: { desc: 'Conta', value: 20, due: '2026-01-10' } },
      cookie
    );
    assert.equal(response.statusCode, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('paying a bill uses one transactional RPC instead of separate writes', async () => {
  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };
  try {
    const response = await request('POST', '/api/pay-bill', {
      id: 'bill-1',
      who: 'Gabriel',
      date: '2026-01-10'
    }, cookie);
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/pay_bill$/);
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.p_bill_id, 'bill-1');
    assert.equal(payload.p_who, 'Gabriel');
    assert.equal(payload.p_date, '2026-01-10');
    assert.match(payload.p_movement_id, /^[\da-f-]{36}$/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a failed transactional RPC returns an error and is never retried record by record', async () => {
  const cookie = await loginCookie();
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  let calls = 0;
  console.error = () => {};
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ code: 'TEST_FAILURE' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const response = await request('POST', '/api/restore', {
      records: [{ collection: 'config', id: 'saldo', data: { value: 500 } }]
    }, cookie);
    assert.equal(response.statusCode, 500);
    assert.match(response.json().error, /não foi possível|recusou/i);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
});

test('unknown methods on known API routes are rejected explicitly', async () => {
  const response = await request('PATCH', '/api/records');
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET, POST, PUT, DELETE');
});

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
