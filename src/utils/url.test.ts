import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalUrl, safeTelHref } from './url.ts';

describe('safeExternalUrl', () => {
  it('accepts valid https and http URLs', () => {
    assert.equal(
      safeExternalUrl('https://maps.google.com/?cid=12345'),
      'https://maps.google.com/?cid=12345'
    );
    assert.equal(safeExternalUrl('  http://clinic.example.org/hours  '), 'http://clinic.example.org/hours');
  });

  it('rejects javascript, data, protocol-relative, and empty URLs', () => {
    assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
    assert.equal(safeExternalUrl('  JAVASCRIPT:void(0) '), undefined);
    assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), undefined);
    assert.equal(safeExternalUrl('//maps.google.com/foo'), undefined);
    assert.equal(safeExternalUrl(''), undefined);
    assert.equal(safeExternalUrl(null), undefined);
    assert.equal(safeExternalUrl(undefined), undefined);
  });
});

describe('safeTelHref', () => {
  it('formats valid phone numbers safely', () => {
    assert.equal(safeTelHref('(415) 555-0199'), 'tel:(415) 555-0199');
    assert.equal(safeTelHref('+1-415-555-0199;ext=1'), 'tel:+1-415-555-01991');
  });

  it('rejects inputs without a real phone number', () => {
    assert.equal(safeTelHref('javascript:alert(1)'), undefined);
    assert.equal(safeTelHref('---'), undefined);
    assert.equal(safeTelHref(''), undefined);
    assert.equal(safeTelHref(null), undefined);
  });
});
