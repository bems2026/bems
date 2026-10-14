import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * `npm run local-control:account` — 2026-10-14 (RM-161). The account a local sign-in commands as
 * (`BREAK_GLASS_USER_ID`) is a 36-character id. Typed by hand at the edge's console, one wrong
 * character still looks like an id: the proxy accepts it, and every local command's record is then
 * refused by the database (the id names no account) and sits at the head of the outage queue,
 * holding back every record behind it. So the id is looked up, shown with its email, and written,
 * never typed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'local-control-account.mjs');
const OPERATOR = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-000000000000';
const GONE = '99999999-9999-9999-9999-999999999999';

function fakeSupabase({ commands, users }) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url, method: req.method, auth: req.headers.authorization });
      if (req.url.startsWith('/rest/v1/commands')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(commands));
      }
      const m = req.url.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
      if (m) {
        const user = users[m[1]];
        res.writeHead(user ? 200 : 404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(user ?? { msg: 'User not found' }));
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() }));
  });
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

const COMMANDS = [
  { requested_by: OPERATOR, requested_at: '2026-10-09T01:00:00Z' },
  { requested_by: GONE, requested_at: '2026-10-08T01:00:00Z' },
  { requested_by: OPERATOR, requested_at: '2026-10-07T01:00:00Z' },
  { requested_by: OTHER, requested_at: '2026-10-01T01:00:00Z' },
];
const USERS = { [OPERATOR]: { id: OPERATOR, email: 'operator@example.test' }, [OTHER]: { id: OTHER, email: 'colleague@example.test' } };

async function withFake(fn) {
  const sb = await fakeSupabase({ commands: COMMANDS, users: USERS });
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-lca-'));
  const envPath = join(dir, '.env');
  fs.writeFileSync(envPath, 'SUPABASE_URL=keep-me\nBREAK_GLASS_PASSWORD_HASH=scrypt$abc\n');
  try {
    return await fn({ sb, envPath, env: { SUPABASE_URL: sb.url, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', LOCAL_CONTROL_ENV_PATH: envPath } });
  } finally {
    sb.close();
  }
}

test('lists the accounts that have sent commands, newest first, with their email, and writes nothing', async () => {
  await withFake(async ({ envPath, env }) => {
    const before = fs.readFileSync(envPath, 'utf8');
    const r = await run([], env);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.indexOf('operator@example.test') < r.out.indexOf('colleague@example.test'), r.out);
    assert.match(r.out, new RegExp(OPERATOR));
    assert.doesNotMatch(r.out, new RegExp(GONE), 'an id that is no longer an account is not offered');
    assert.doesNotMatch(r.out, /test-service-key/, 'the key is never printed');
    assert.equal(fs.readFileSync(envPath, 'utf8'), before);
  });
});

test('--write sets BREAK_GLASS_USER_ID to the newest account, keeping every other line', async () => {
  await withFake(async ({ envPath, env }) => {
    const r = await run(['--write'], env);
    assert.equal(r.code, 0, r.out);
    const text = fs.readFileSync(envPath, 'utf8');
    assert.match(text, new RegExp(`^BREAK_GLASS_USER_ID=${OPERATOR}$`, 'm'));
    assert.match(text, /^SUPABASE_URL=keep-me$/m);
    assert.match(text, /^BREAK_GLASS_PASSWORD_HASH=scrypt\$abc$/m);
    assert.match(r.out, /operator@example\.test/);
    assert.match(r.out, /systemctl restart ibems-proxy/);
  });
});

test('--write replaces an existing BREAK_GLASS_USER_ID rather than adding a second', async () => {
  await withFake(async ({ envPath, env }) => {
    fs.appendFileSync(envPath, `BREAK_GLASS_USER_ID=${GONE}\n`);
    const r = await run(['--write'], env);
    assert.equal(r.code, 0, r.out);
    const lines = fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.startsWith('BREAK_GLASS_USER_ID='));
    assert.deepEqual(lines, [`BREAK_GLASS_USER_ID=${OPERATOR}`]);
  });
});

test('--write=<id> picks a listed account, and refuses one that is not', async () => {
  await withFake(async ({ envPath, env }) => {
    const ok = await run([`--write=${OTHER}`], env);
    assert.equal(ok.code, 0, ok.out);
    assert.match(fs.readFileSync(envPath, 'utf8'), new RegExp(`^BREAK_GLASS_USER_ID=${OTHER}$`, 'm'));

    const refused = await run([`--write=${GONE}`], env);
    assert.notEqual(refused.code, 0);
    assert.match(fs.readFileSync(envPath, 'utf8'), new RegExp(`^BREAK_GLASS_USER_ID=${OTHER}$`, 'm'), 'left as it was');
  });
});

test('without internet it says so, and writes nothing', async () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-lca-'));
  const envPath = join(dir, '.env');
  fs.writeFileSync(envPath, 'A=1\n');
  const r = await run(['--write'], { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'k', LOCAL_CONTROL_ENV_PATH: envPath });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /internet|reach/i);
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'A=1\n');
});
