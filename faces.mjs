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
