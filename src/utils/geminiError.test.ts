import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGeminiError,
  extractRetryDelayMs,
  formatGeminiCooldownNotice,
  formatGeminiUserNotice,
  isHardQuotaExhausted,
  isInvalidArgumentError,
  shouldCooldownPrimaryModel,
  shouldFallbackFromPrimaryModel,
} from './geminiError.ts';

test('classifyGeminiError detects 429 RESOURCE_EXHAUSTED quota errors', () => {
  const err = new Error(
    '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}'
  );
  assert.equal(classifyGeminiError(err), 'quota');
  assert.equal(isHardQuotaExhausted(err), true);
  const notice = formatGeminiUserNotice(err);
  assert.match(notice, /Settings > Secrets/i);
  assert.match(notice, /quota/i);
});

test('classifyGeminiError detects 403 PERMISSION_DENIED and 400 API_KEY_INVALID', () => {
  const err403 = Object.assign(new Error('Request had insufficient authentication scopes.'), {
    status: 403,
  });
  assert.equal(classifyGeminiError(err403), 'auth');
  assert.match(formatGeminiUserNotice(err403), /Settings > Secrets/i);

  const errInvalid = new Error('API_KEY_INVALID: API key not valid.');
  assert.equal(classifyGeminiError(errInvalid), 'auth');
});

test('classifyGeminiError detects transient 503 UNAVAILABLE errors', () => {
  const err503 = Object.assign(new Error('The service is currently UNAVAILABLE.'), {
    status: 503,
  });
  assert.equal(classifyGeminiError(err503), 'transient');
  assert.equal(isHardQuotaExhausted(err503), false);
});

test('extractRetryDelayMs parses RetryInfo seconds and caps safely', () => {
  const errShort = new Error('{"retryDelay":"1.5s"}');
  assert.equal(extractRetryDelayMs(errShort), 1500);

  const errLong = new Error('{"retryDelay":"45s"}');
  assert.equal(extractRetryDelayMs(errLong, 2500), 2500);

  const errNone = new Error('Quota exceeded');
  assert.equal(extractRetryDelayMs(errNone), null);
});

test('shouldFallbackFromPrimaryModel falls back for unavailability/quota/404/403-model errors but not invalid API key', () => {
  assert.equal(
    shouldFallbackFromPrimaryModel(Object.assign(new Error('Model not found'), { status: 404 })),
    true
  );
  assert.equal(
    shouldFallbackFromPrimaryModel(Object.assign(new Error('UNAVAILABLE'), { status: 503 })),
    true
  );
  assert.equal(
    shouldFallbackFromPrimaryModel(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 })),
    true
  );
  assert.equal(
    shouldFallbackFromPrimaryModel(Object.assign(new Error('PERMISSION_DENIED on model'), { status: 403 })),
    true
  );
  assert.equal(
    shouldFallbackFromPrimaryModel(new Error('API_KEY_INVALID: API key not valid.')),
    false
  );
  assert.equal(
    shouldFallbackFromPrimaryModel(Object.assign(new Error('Unauthorized'), { status: 401 })),
    false
  );
  assert.equal(
    shouldFallbackFromPrimaryModel(
      Object.assign(new Error('INVALID_ARGUMENT: unsupported tool combo'), { status: 400 })
    ),
    false
  );
});

test('isInvalidArgumentError and shouldCooldownPrimaryModel prevent 400 and 503 cooldown poisoning', () => {
  const err400 = Object.assign(new Error('INVALID_ARGUMENT: hybrid tool not supported'), {
    status: 400,
  });
  const err503 = Object.assign(new Error('UNAVAILABLE'), { status: 503 });
  const err404 = Object.assign(new Error('Model not found'), { status: 404 });
  const errHardQuota = new Error(
    '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}'
  );

  assert.equal(isInvalidArgumentError(err400), true);
  assert.equal(isInvalidArgumentError(new Error('API_KEY_INVALID')), false);
  assert.equal(shouldCooldownPrimaryModel(err400), false);
  assert.equal(shouldCooldownPrimaryModel(err503), false);
  assert.equal(shouldCooldownPrimaryModel(err404), true);
  assert.equal(shouldCooldownPrimaryModel(errHardQuota), true);
  assert.match(formatGeminiCooldownNotice(), /quota/i);
});
