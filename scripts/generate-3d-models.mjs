#!/usr/bin/env node
/**
 * Generates self-contained, zero-extension glTF 2.0 binary (.glb) 3D models
 * for Google Maps Platform `Model3DElement` / `Model3DInteractiveElement`:
 *   - public/models/meridian-beacon.glb (focused destination sculpted beacon)
 *   - public/models/origin-beacon.glb   (starting-location compass plinth)
 *
 * Uses only core glTF 2.0 PBR metallic-roughness materials (no extensions),
 * standard Y-up coordinates (rotated upright in Maps 3D via tilt: 270),
 * and explicit flat-shaded normals for crisp architectural facets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/models');

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.indices = [];
  }

  addTriangle(a, b, c) {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    const base = this.positions.length / 3;
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  addQuad(a, b, c, d) {
    this.addTriangle(a, b, c);
    this.addTriangle(a, c, d);
  }

  /**
   * Adds a vertical frustum/cylinder/cone centered on Y axis.
   * For a downward cone set rBottom = 0; for an upward cone set rTop = 0.
   */
  addFrustum({ yBottom, yTop, rBottom, rTop, segments = 16, capBottom = true, capTop = true }) {
    const ringBottom = [];
    const ringTop = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ringBottom.push([rBottom * cos, yBottom, rBottom * sin]);
      ringTop.push([rTop * cos, yTop, rTop * sin]);
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      if (rBottom > 1e-5 && rTop > 1e-5) {
        // Outward-facing CCW when viewed from outside (+radius)
        this.addQuad(ringBottom[i], ringTop[i], ringTop[next], ringBottom[next]);
      } else if (rBottom <= 1e-5 && rTop > 1e-5) {
        this.addTriangle([0, yBottom, 0], ringTop[i], ringTop[next]);
      } else if (rTop <= 1e-5 && rBottom > 1e-5) {
        this.addTriangle(ringBottom[i], [0, yTop, 0], ringBottom[next]);
      }
    }

    if (capBottom && rBottom > 1e-5) {
      const center = [0, yBottom, 0];
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        this.addTriangle(center, ringBottom[i], ringBottom[next]);
      }
    }
    if (capTop && rTop > 1e-5) {
      const center = [0, yTop, 0];
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        this.addTriangle(center, ringTop[next], ringTop[i]);
      }
    }
  }

  /**
   * Adds a flat horizontal ring washer between rInner and rOuter.
   */
  addAnnulus({ yBottom, yTop, rInner, rOuter, segments = 24 }) {
    const botIn = [];
    const botOut = [];
    const topIn = [];
    const topOut = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      botIn.push([rInner * c, yBottom, rInner * s]);
      botOut.push([rOuter * c, yBottom, rOuter * s]);
      topIn.push([rInner * c, yTop, rInner * s]);
      topOut.push([rOuter * c, yTop, rOuter * s]);
    }
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments;
      // Outer wall
      this.addQuad(botOut[i], topOut[i], topOut[n], botOut[n]);
      // Inner wall
      this.addQuad(botIn[n], topIn[n], topIn[i], botIn[i]);
      // Top cap (+Y)
      this.addQuad(topOut[i], topIn[i], topIn[n], topOut[n]);
      // Bottom cap (-Y)
      this.addQuad(botIn[i], botOut[i], botOut[n], botIn[n]);
    }
  }

  /**
   * Adds a sleek torus ring centered at (0, yCenter, 0), optionally tilted around X.
   */
  addTorus({ yCenter, majorRadius, tubeRadius, majorSegments = 24, tubeSegments = 10, tiltXRad = 0 }) {
    const cosT = Math.cos(tiltXRad);
    const sinT = Math.sin(tiltXRad);
    const point = (u, v) => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const x = (majorRadius + tubeRadius * cv) * cu;
      const y0 = tubeRadius * sv;
      const z0 = (majorRadius + tubeRadius * cv) * su;
      const y = y0 * cosT - z0 * sinT + yCenter;
      const z = y0 * sinT + z0 * cosT;
      return [x, y, z];
    };

    for (let i = 0; i < majorSegments; i++) {
      const u0 = (i / majorSegments) * Math.PI * 2;
      const u1 = ((i + 1) / majorSegments) * Math.PI * 2;
      for (let j = 0; j < tubeSegments; j++) {
        const v0 = (j / tubeSegments) * Math.PI * 2;
        const v1 = ((j + 1) / tubeSegments) * Math.PI * 2;
        const p00 = point(u0, v0);
        const p10 = point(u1, v0);
        const p11 = point(u1, v1);
        const p01 = point(u0, v1);
        this.addQuad(p00, p01, p11, p10);
      }
    }
  }

  /**
   * Adds a low-poly UV sphere centered at (0, yCenter, 0).
   */
  addSphere({ yCenter, radius, widthSegments = 16, heightSegments = 10 }) {
    const pt = (latIdx, lonIdx) => {
      const phi = (latIdx / heightSegments) * Math.PI;
      const theta = (lonIdx / widthSegments) * Math.PI * 2;
      return [
        radius * Math.sin(phi) * Math.cos(theta),
        yCenter + radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      ];
    };

    for (let lat = 0; lat < heightSegments; lat++) {
      for (let lon = 0; lon < widthSegments; lon++) {
        const a = pt(lat, lon);
        const b = pt(lat + 1, lon);
        const c = pt(lat + 1, lon + 1);
        const d = pt(lat, lon + 1);
        if (lat === 0) {
          this.addTriangle(a, c, b);
        } else if (lat === heightSegments - 1) {
          this.addTriangle(a, d, b);
        } else {
          this.addQuad(a, d, c, b);
        }
      }
    }
  }
}

function packGlb(parts) {
  const materials = [];
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  const binaryChunks = [];
  let byteOffset = 0;

  const appendTypedArray = (typedArray, target) => {
    const pad = (4 - (byteOffset % 4)) % 4;
    if (pad > 0) {
      binaryChunks.push(Buffer.alloc(pad));
      byteOffset += pad;
    }
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const viewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: buf.byteLength,
      target,
    });
    binaryChunks.push(buf);
    byteOffset += buf.byteLength;
    return viewIndex;
  };

  for (const part of parts) {
    const materialIndex = materials.length;
    materials.push({
      name: part.name,
      pbrMetallicRoughness: {
        baseColorFactor: part.baseColor,
        metallicFactor: part.metallic,
        roughnessFactor: part.roughness,
      },
      ...(part.emissive ? { emissiveFactor: part.emissive } : {}),
      doubleSided: false,
    });

    const posArr = new Float32Array(part.mesh.positions);
    const normArr = new Float32Array(part.mesh.normals);
    const idxArr = new Uint16Array(part.mesh.indices);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posArr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (posArr[i + k] < min[k]) min[k] = posArr[i + k];
        if (posArr[i + k] > max[k]) max[k] = posArr[i + k];
      }
    }

    const posView = appendTypedArray(posArr, 34962); // ARRAY_BUFFER
    const normView = appendTypedArray(normArr, 34962); // ARRAY_BUFFER
    const idxView = appendTypedArray(idxArr, 34963); // ELEMENT_ARRAY_BUFFER

    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: posArr.length / 3,
      type: 'VEC3',
      min,
      max,
    });

    const normAccessor = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: 5126, // FLOAT
      count: normArr.length / 3,
      type: 'VEC3',
    });

    const idxAccessor = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5123, // UNSIGNED_SHORT
      count: idxArr.length,
      type: 'SCALAR',
    });

    primitives.push({
      attributes: {
        POSITION: posAccessor,
        NORMAL: normAccessor,
      },
      indices: idxAccessor,
      material: materialIndex,
    });
  }

  // Pad total BIN chunk to 4-byte boundary
  const binPad = (4 - (byteOffset % 4)) % 4;
  if (binPad > 0) {
    binaryChunks.push(Buffer.alloc(binPad));
    byteOffset += binPad;
  }
  const binBuffer = Buffer.concat(binaryChunks);

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'meridian-showcase-glb-builder',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'MeridianBeaconRoot' }],
    meshes: [{ name: 'BeaconMesh', primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.byteLength }],
  };

  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.byteLength % 4)) % 4;
  if (jsonPad > 0) {
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  }

  const totalLength = 12 + 8 + jsonBuf.byteLength + 8 + binBuffer.byteLength;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.byteLength, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuffer.byteLength, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuffer]);
}

function buildMeridianDestinationBeacon() {
  // 1. Ground slate pedestal disc
  const baseSlate = new MeshBuilder();
  baseSlate.addFrustum({ yBottom: 0.0, yTop: 0.18, rBottom: 1.05, rTop: 0.94, segments: 24 });

  // 2. Crisp white architectural locator ring + tilted orbital halo
  const whiteTrim = new MeshBuilder();
  whiteTrim.addAnnulus({ yBottom: 0.18, yTop: 0.28, rInner: 0.64, rOuter: 0.92, segments: 24 });
  whiteTrim.addTorus({
    yCenter: 2.25,
    majorRadius: 1.08,
    tubeRadius: 0.065,
    majorSegments: 28,
    tubeSegments: 10,
    tiltXRad: 0.42,
  });

  // 3. Deep teal lower locator spire + lower crystal facets
  const deepTeal = new MeshBuilder();
  deepTeal.addFrustum({ yBottom: 0.34, yTop: 1.05, rBottom: 0.0, rTop: 0.28, segments: 8, capBottom: false });
  deepTeal.addFrustum({ yBottom: 1.25, yTop: 2.25, rBottom: 0.0, rTop: 0.78, segments: 8, capBottom: false, capTop: false });

  // 4. Luminous bright-teal upper faceted crown + floating apex jewel
  const brightTeal = new MeshBuilder();
  brightTeal.addFrustum({ yBottom: 2.25, yTop: 3.35, rBottom: 0.78, rTop: 0.0, segments: 8, capBottom: false, capTop: false });
  brightTeal.addSphere({ yCenter: 3.68, radius: 0.2, widthSegments: 14, heightSegments: 8 });

  return packGlb([
    {
      name: 'SlateBase',
      mesh: baseSlate,
      baseColor: [0.06, 0.09, 0.16, 1.0],
      metallic: 0.22,
      roughness: 0.42,
    },
    {
      name: 'PorcelainHalo',
      mesh: whiteTrim,
      baseColor: [0.97, 0.98, 0.99, 1.0],
      metallic: 0.12,
      roughness: 0.24,
      emissive: [0.12, 0.14, 0.16],
    },
    {
      name: 'DeepTealSpire',
      mesh: deepTeal,
      baseColor: [0.06, 0.46, 0.43, 1.0],
      metallic: 0.32,
      roughness: 0.26,
      emissive: [0.02, 0.12, 0.11],
    },
    {
      name: 'LuminousTealCrown',
      mesh: brightTeal,
      baseColor: [0.08, 0.72, 0.65, 1.0],
      metallic: 0.24,
      roughness: 0.18,
      emissive: [0.05, 0.26, 0.24],
    },
  ]);
}

function buildOriginCompassBeacon() {
  // 1. Dark slate outer puck
  const outerSlate = new MeshBuilder();
  outerSlate.addFrustum({ yBottom: 0.0, yTop: 0.22, rBottom: 0.95, rTop: 0.85, segments: 24 });

  // 2. Crisp white inner compass collar
  const whiteRing = new MeshBuilder();
  whiteRing.addAnnulus({ yBottom: 0.22, yTop: 0.34, rInner: 0.46, rOuter: 0.78, segments: 24 });

  // 3. Bright teal center origin dome
  const centerDome = new MeshBuilder();
  centerDome.addSphere({ yCenter: 0.38, radius: 0.34, widthSegments: 16, heightSegments: 10 });

  return packGlb([
    {
      name: 'OriginSlateBezel',
      mesh: outerSlate,
      baseColor: [0.06, 0.09, 0.16, 1.0],
      metallic: 0.2,
      roughness: 0.4,
    },
    {
      name: 'OriginWhiteRing',
      mesh: whiteRing,
      baseColor: [0.98, 0.99, 1.0, 1.0],
      metallic: 0.1,
      roughness: 0.22,
      emissive: [0.14, 0.15, 0.17],
    },
    {
      name: 'OriginTealCore',
      mesh: centerDome,
      baseColor: [0.08, 0.72, 0.65, 1.0],
      metallic: 0.2,
      roughness: 0.22,
      emissive: [0.06, 0.28, 0.25],
    },
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const destGlb = buildMeridianDestinationBeacon();
const originGlb = buildOriginCompassBeacon();
fs.writeFileSync(path.join(OUT_DIR, 'meridian-beacon.glb'), destGlb);
fs.writeFileSync(path.join(OUT_DIR, 'origin-beacon.glb'), originGlb);

console.log(
  `Generated public/models/meridian-beacon.glb (${destGlb.byteLength} bytes) and origin-beacon.glb (${originGlb.byteLength} bytes)`
);
