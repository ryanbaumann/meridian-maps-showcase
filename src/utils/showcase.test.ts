import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUsableMapsApiKey } from '../../server/mapsApi.ts';
import { SHOWCASE_CONFIG } from '../config/showcase.ts';

describe('isUsableMapsApiKey', () => {
  it('rejects empty, whitespace, and placeholder API keys', () => {
    assert.equal(isUsableMapsApiKey(''), false);
    assert.equal(isUsableMapsApiKey('   '), false);
    assert.equal(isUsableMapsApiKey(undefined), false);
    assert.equal(isUsableMapsApiKey(null), false);
    assert.equal(isUsableMapsApiKey('MY_GOOGLE_MAPS_API_KEY'), false);
    assert.equal(isUsableMapsApiKey('YOUR_MAPS_KEY'), false);
    assert.equal(isUsableMapsApiKey('PLACEHOLDER_KEY'), false);
    assert.equal(isUsableMapsApiKey('AIza bad key'), false);
  });

  it('accepts valid non-placeholder API key strings', () => {
    assert.equal(isUsableMapsApiKey('sample_non_placeholder_key_value_01'), true);
    assert.equal(
      isUsableMapsApiKey(['test', 'prefix', 'key', '1234567890'].join('-')),
      true
    );
  });
});

describe('SHOWCASE_CONFIG agent blueprint', () => {
  it('defines a complete fork-ready specialist finder blueprint', () => {
    const { agent } = SHOWCASE_CONFIG;
    assert.ok(agent.roleLabel.length > 0);
    assert.ok(agent.persona.length > 0);
    assert.ok(agent.intentGuidance.length > 0);
    assert.ok(agent.knownCategories.length >= 10);
    assert.ok(agent.exampleCities.length >= 3);
    assert.ok(agent.noOriginFollowUps.length >= 3);
    assert.ok(agent.originFollowUpTemplates.length >= 3);
    assert.equal(
      Math.round(
        (agent.rankingWeights.rating +
          agent.rankingWeights.travelTime +
          agent.rankingWeights.distance) *
          100
      ),
      100
    );
    assert.deepEqual([...SHOWCASE_CONFIG.attributionIds], [
      'gmp_mcp_codeassist_v1_aistudio',
      'gmp_git_agentskills_v1',
    ]);
  });
});
