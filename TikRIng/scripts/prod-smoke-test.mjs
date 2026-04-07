const baseUrl = (process.env.BASE_URL || '').trim().replace(/\/$/, '');
const sessionCookie = (process.env.PROD_TEST_SESSION_COOKIE || '').trim();
const expectedFrameId = (process.env.PROD_TEST_FRAME_ID || '').trim();
const requireAuthChecks = (process.env.PROD_REQUIRE_AUTH_CHECKS || '0') === '1';
const requireFrameData = (process.env.PROD_REQUIRE_FRAME_DATA || '1') === '1';

if (!baseUrl) {
  console.error('BASE_URL is required');
  process.exit(1);
}

const failures = [];

function ensure(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { cookie = '', expectedType = '' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'follow',
  });

  const contentType = response.headers.get('content-type') || '';
  let body;
  if (expectedType === 'json' || contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return { response, contentType, body };
}

async function withRetries(label, fn, attempts = 5, delayMs = 5000) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`${label}: retry ${attempt}/${attempts - 1}`);
        await wait(delayMs);
      }
    }
  }

  throw lastError;
}

async function run() {
  console.log(`Checking production site: ${baseUrl}`);

  const home = await withRetries('home page', async () => {
    const result = await request('/');
    if (!result.response.ok) {
      throw new Error(`home page returned ${result.response.status}`);
    }
    return result;
  });
  ensure(home.contentType.includes('text/html'), 'Home page did not return HTML');
  ensure(typeof home.body === 'string' && home.body.includes('<div id="root">'), 'Home page HTML did not include the app root');

  const health = await withRetries('health endpoint', async () => {
    const result = await request('/api/health', { expectedType: 'json' });
    if (!result.response.ok) {
      throw new Error(`health endpoint returned ${result.response.status}`);
    }
    return result;
  });
  ensure(health.body && health.body.ok === true, 'Health endpoint did not return { ok: true }');

  if (requireAuthChecks) {
    ensure(Boolean(sessionCookie), 'PROD_TEST_SESSION_COOKIE is required when PROD_REQUIRE_AUTH_CHECKS=1');
  }

  if (sessionCookie) {
    const auth = await withRetries('authenticated auth/me', async () => {
      const result = await request('/api/auth/me', { cookie: sessionCookie, expectedType: 'json' });
      if (!result.response.ok) {
        throw new Error(`auth/me returned ${result.response.status}`);
      }
      return result;
    });

    ensure(auth.body && auth.body.user, 'Authenticated auth/me did not return a user');
    ensure(auth.body?.user?.plan === 'pro', `Authenticated test user is not pro: ${auth.body?.user?.plan ?? 'unknown'}`);

    const frames = await withRetries('authenticated frames list', async () => {
      const result = await request('/api/frames', { cookie: sessionCookie, expectedType: 'json' });
      if (!result.response.ok) {
        throw new Error(`frames endpoint returned ${result.response.status}`);
      }
      return result;
    });

    const items = Array.isArray(frames.body?.frames) ? frames.body.frames : [];
    let targets = items;

    if (expectedFrameId) {
      const target = items.find((item) => item?.id === expectedFrameId);
      ensure(Boolean(target), `Expected frame ${expectedFrameId} was not returned by /api/frames`);
      targets = target ? [target] : [];
    }

    if (requireFrameData) {
      ensure(targets.length > 0, 'No frames were returned for authenticated production verification');
    }

    for (const frame of targets) {
      ensure(typeof frame.viewCount === 'number', `Frame ${frame.id ?? 'unknown'} did not expose numeric viewCount`);
      ensure(typeof frame.wearCount === 'number', `Frame ${frame.id ?? 'unknown'} did not expose numeric wearCount`);
    }
  }

  if (failures.length > 0) {
    console.error('Production smoke test failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Production smoke test passed');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});