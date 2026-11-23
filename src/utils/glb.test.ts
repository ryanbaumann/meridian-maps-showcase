import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../public/models');

function validateGlb(filePath: string) {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.byteLength >= 28, 'GLB must include header and chunks');

  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const totalLen = buf.readUInt32LE(8);
  assert.equal(magic, 0x46546c67, 'GLB magic must be glTF');
  assert.equal(version, 2, 'GLB version must be 2');
  assert.equal(totalLen, buf.byteLength, 'GLB declared total length must match file size');

  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a, 'First chunk must be JSON');
  assert.equal(jsonLen % 4, 0, 'JSON chunk length must be 4-byte aligned');

  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  assert.equal(json.asset?.version, '2.0');
  assert.equal(json.extensionsUsed, undefined, 'Must not use unsupported glTF extensions for Maps 3D');
  assert.equal(json.extensionsRequired, undefined, 'Must not require glTF extensions for Maps 3D');
  assert.ok(Array.isArray(json.meshes) && json.meshes.length > 0, 'Must contain at least one mesh');
  assert.ok(Array.isArray(json.materials) && json.materials.length > 0, 'Must contain PBR materials');

  const binOffset = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binOffset);
  const binType = buf.readUInt32LE(binOffset + 4);
  assert.equal(binType, 0x004e4942, 'Second chunk must be BIN');
  assert.equal(binLen % 4, 0, 'BIN chunk length must be 4-byte aligned');
  assert.equal(binOffset + 8 + binLen, buf.byteLength, 'BIN chunk must end cleanly at EOF');
  assert.equal(json.buffers?.[0]?.byteLength, binLen);

  // Verify every POSITION accessor defines finite min/max bounds and fits inside BIN
  for (const prim of json.meshes[0].primitives) {
    const posAcc = json.accessors[prim.attributes.POSITION];
    assert.ok(Array.isArray(posAcc.min) && posAcc.min.length === 3);
    assert.ok(Array.isArray(posAcc.max) && posAcc.max.length === 3);
    assert.ok(posAcc.min.every((v: number) => Number.isFinite(v)));
    assert.ok(posAcc.max.every((v: number) => Number.isFinite(v)));
    assert.ok(posAcc.min[1] >= -1e-4, 'Model should rest cleanly at or above Y=0');
  }
  for (const bv of json.bufferViews) {
    assert.ok(bv.byteOffset + bv.byteLength <= binLen, 'BufferView must stay within BIN buffer');
  }
}

describe('Custom 3D GLB models for Google Maps Model3DElement', () => {
  it('meridian-beacon.glb is a valid extension-free glTF 2.0 binary', () => {
    validateGlb(path.join(MODELS_DIR, 'meridian-beacon.glb'));
  });

  it('origin-beacon.glb is a valid extension-free glTF 2.0 binary', () => {
    validateGlb(path.join(MODELS_DIR, 'origin-beacon.glb'));
  });
});
