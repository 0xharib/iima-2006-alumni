"""Face service for the IIMA 2006 reunion site.

Runs in a Cloudflare Container. POST /faces?mode=photo|portrait with image bytes returns every face found (or, for
portrait, the largest one) with a unit-length ArcFace embedding. Models: InsightFace buffalo_l (SCRFD-10G detector,
ArcFace R50 recogniser), loaded once at start from FACE_MODELS (default /models).

Lessons from the test bench, kept here on purpose:
- never enlarge an image before detection, and use only a few fixed input sizes (onnxruntime keeps memory for
  every input shape it has seen);
- SCRFD misses a face that fills the frame, so retry once with a black border round the image.
"""
import base64, io, json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image, ImageOps

MODEL = "buffalo_l/w600k_r50"
MAX_SIDE = 1600
SIDES = (320, 512, 768, 1024)
BORDER = 0.4

models = None   # (detector, recogniser)
# One analysis at a time: the container has one vCPU, and parallel inference only slows every request and risks memory.
INFERENCE = threading.Lock()


def load_models(folder):
    import cv2  # noqa: F401  (insightface needs it)
    from insightface import model_zoo
    det = model_zoo.get_model(os.path.join(folder, "det_10g.onnx"))
    det.prepare(ctx_id=-1, det_thresh=0.5, input_size=(1024, 1024))
    rec = model_zoo.get_model(os.path.join(folder, "w600k_r50.onnx"))
    rec.prepare(ctx_id=-1)
    return det, rec


def prepare(data):
    """Image bytes → BGR array, EXIF-rotated, at most MAX_SIDE on the long side, never enlarged."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as error:
        raise ValueError("unreadable image") from error
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return np.ascontiguousarray(np.asarray(img)[:, :, ::-1])


def input_side(h, w):
    longest = min(max(h, w), SIDES[-1])
    return next(side for side in SIDES if side >= longest)


def _run(img, detector):
    side = input_side(*img.shape[:2])
    boxes, kps = detector.detect(img, input_size=(side, side))
    return [(list(map(float, b[:4])), float(b[4]), np.asarray(k, dtype=np.float32)) for b, k in zip(boxes, kps)]


def detect(img, detector):
    found = _run(img, detector)
    if found:
        return found
    h, w = img.shape[:2]
    pad = int(max(h, w) * BORDER)
    padded = np.zeros((h + 2 * pad, w + 2 * pad, 3), dtype=img.dtype)
    padded[pad:pad + h, pad:pad + w] = img
    return [([v - pad for v in box], score, kps - pad) for box, score, kps in _run(padded, detector)]


def embed(img, kps, recogniser):
    from insightface.utils import face_align
    crop = face_align.norm_crop(img, landmark=kps, image_size=112)
    vec = np.asarray(recogniser.get_feat(crop), dtype=np.float32).ravel()
    return vec / (np.linalg.norm(vec) + 1e-9)


def analyse(data, mode):
    global models
    if models is None:
        models = load_models(os.environ.get("FACE_MODELS", "/models"))
    detector, recogniser = models
    img = prepare(data)
    found = detect(img, detector)
    if mode == "portrait" and found:
        found = [max(found, key=lambda f: (f[0][2] - f[0][0]) * (f[0][3] - f[0][1]) * f[1])]
    faces = []
    for box, score, kps in found:
        vec = embed(img, kps, recogniser).astype("<f4")
        faces.append({
            "box": [round(v, 1) for v in box],
            "score": round(score, 4),
            "size": int(round(min(box[2] - box[0], box[3] - box[1]))),
            "embedding": base64.b64encode(vec.tobytes()).decode(),
        })
    h, w = img.shape[:2]
    return {"model": MODEL, "width": w, "height": h, "faces": faces}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._send(200 if models else 503, {"ok": bool(models), "model": MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/faces":
            return self._send(404, {"error": "not found"})
        mode = parse_qs(url.query).get("mode", ["photo"])[0]
        if mode not in ("photo", "portrait"):
            return self._send(400, {"error": "unknown mode"})
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= 20 * 1024 * 1024:
            return self._send(400, {"error": "unreadable image"})
        data = self.rfile.read(length)
        try:
            with INFERENCE:
                result = analyse(data, mode)
            return self._send(200, result)
        except ValueError:
            return self._send(400, {"error": "unreadable image"})

    def log_message(self, *args):
        pass


def main():
    global models
    models = load_models(os.environ.get("FACE_MODELS", "/models"))
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
