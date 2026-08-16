import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashBreakGlassPassword, verifyBreakGlassPassword } from './breakGlass.mjs';

test('a password verifies against its own hash', () => {
  const hash = hashBreakGlassPassword('correct horse battery staple');
  assert.equal(verifyBreakGlassPassword('correct horse battery staple', hash), true);
});

test('the wrong password is rejected', () => {
  const hash = hashBreakGlassPassword('correct horse battery staple');
  assert.equal(verifyBreakGlassPassword('wrong password', hash), false);
});

test('two hashes of the same password differ (random salt) but both verify', () => {
  const a = hashBreakGlassPassword('same password');
  const b = hashBreakGlassPassword('same password');
  assert.notEqual(a, b);
  assert.equal(verifyBreakGlassPassword('same password', a), true);
  assert.equal(verifyBreakGlassPassword('same password', b), true);
});

test('malformed/absent stored hash is rejected, not thrown', () => {
  assert.equal(verifyBreakGlassPassword('anything', undefined), false);
  assert.equal(verifyBreakGlassPassword('anything', ''), false);
  assert.equal(verifyBreakGlassPassword('anything', 'not-hex:also-not-hex'), false);
  assert.equal(verifyBreakGlassPassword('anything', 'no-colon-at-all'), false);
});

test('non-string password input is rejected, not thrown', () => {
  const hash = hashBreakGlassPassword('whatever');
  assert.equal(verifyBreakGlassPassword(undefined, hash), false);
  assert.equal(verifyBreakGlassPassword(null, hash), false);
  assert.equal(verifyBreakGlassPassword(12345, hash), false);
});
