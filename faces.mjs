// Automatic face tagging: matching, the face-service client, queue jobs, consent and admin.
// Design: docs/superpowers/specs/2026-11-25-face-tagging-design.md

export const FACE_BAR = 0.35;
export const FACE_MODEL = 'buffalo_l/w600k_r50';

export const faceMode = env => ['off','shadow','on'].includes(env?.FACE_TAGGING) ? env.FACE_TAGGING : 'off';

// D1 hands BLOBs back as ArrayBuffer or number[]; node:sqlite as Uint8Array.
export function toVector(blob) {
  const bytes = blob instanceof Uint8Array ? blob : blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export const vectorBytes = vector => new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function similarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// Each face goes to at most one member and each member to at most one face, best score first.
export function assign(faces, refs) {
  const pairs = [];
  for (const face of faces) {
    for (const [member, vectors] of refs) {
      let best = -1;
      for (const ref of vectors) best = Math.max(best, similarity(face.vector, ref));
      if (best >= FACE_BAR) pairs.push({face: face.id, member, score: best});
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedFaces = new Set(), usedMembers = new Set(), chosen = [];
  for (const pair of pairs) {
    if (usedFaces.has(pair.face) || usedMembers.has(pair.member)) continue;
    usedFaces.add(pair.face); usedMembers.add(pair.member); chosen.push(pair);
  }
  return chosen;
}

// ---------- the container that runs face-service/app.py ----------

const IDLE_MS = 5 * 60 * 1000;
const START_TIMEOUT_MS = 60 * 1000;

// A plain Durable Object class (no `cloudflare:workers` import, so tests can load this module).
export class FaceContainer {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.clock = () => Date.now();
    this.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
    const container = this.state.container;
    if (!container.running) container.start({enableInternet: false});
    await this.state.storage.put('lastUsed', this.clock());
    await this.state.storage.setAlarm(this.clock() + IDLE_MS);
    const deadline = this.clock() + START_TIMEOUT_MS;
    // The container takes a few seconds to load the models after a cold start.
    for (;;) {
      try {
        return await container.getTcpPort(8080).fetch('http://container' + url.pathname + url.search,
          {method: request.method, body, headers: {'Content-Type': 'application/octet-stream'}});
      } catch (error) {
        if (this.clock() >= deadline) return new Response('face service unavailable', {status: 503});
        await this.sleep(500);
      }
    }
  }

  async alarm() {
    const lastUsed = (await this.state.storage.get('lastUsed')) || 0;
    if (this.clock() - lastUsed >= IDLE_MS) {
      if (this.state.container.running) await this.state.container.destroy();
    } else {
      await this.state.storage.setAlarm(lastUsed + IDLE_MS);
    }
  }
}

// Send image bytes to the face service. Locally, FACE_SERVICE_URL points at `python3 face-service/app.py`.
export async function analyseImage(env, bytes, mode) {
  const path = '/faces?mode=' + mode;
  const init = {method: 'POST', body: bytes, headers: {'Content-Type': 'application/octet-stream'}};
  const response = env.FACE_SERVICE_URL
    ? await fetch(env.FACE_SERVICE_URL.replace(/\/$/, '') + path, init)
    : await env.FACES.get(env.FACES.idFromName('matcher')).fetch('https://faces' + path, init);
  if (response.status !== 200) throw new Error('face service ' + response.status);
  const result = await response.json();
  return {...result, faces: result.faces.map(face => {
    const faceBytes = fromBase64(face.embedding);
    return {box: face.box, score: face.score, size: face.size, bytes: faceBytes, vector: toVector(faceBytes)};
  })};
}
