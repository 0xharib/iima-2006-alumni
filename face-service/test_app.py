"""Tests for the face service. A fake detector and recogniser stand in for the models; no real faces are used.

Run: python3 -m unittest -v            (unit tests)
     FACE_MODELS=/path/to/buffalo_l python3 -m unittest -v   (also runs the model check)
"""
import base64, io, json, os, threading, unittest, urllib.request
from http.server import ThreadingHTTPServer

import numpy as np
from PIL import Image

import app


def jpeg(w, h, orientation=None, fmt="JPEG"):
    img = Image.new("RGB", (w, h), (120, 90, 60))
    buf = io.BytesIO()
    if orientation:
        exif = Image.Exif()
        exif[0x0112] = orientation
        img.save(buf, fmt, exif=exif)
    else:
        img.save(buf, fmt)
    return buf.getvalue()


class FakeDetector:
    """Returns the faces given for an image of a given shape; records the input sizes asked for."""

    def __init__(self, by_shape):
        self.by_shape, self.sizes = by_shape, []

    def detect(self, img, input_size):
        self.sizes.append(input_size)
        faces = self.by_shape.get(img.shape[:2], [])
        boxes = np.array([f[0] + [f[1]] for f in faces], dtype=np.float32).reshape(-1, 5)
        kps = np.array([f[2] for f in faces], dtype=np.float32).reshape(-1, 5, 2)
        return boxes, kps


class FakeRecogniser:
    def get_feat(self, crop):
        v = np.zeros((1, 512), dtype=np.float32)
        v[0, 0], v[0, 1] = 3.0, 4.0     # normalises to 0.6, 0.8
        return v


def kps_at(x, y):
    return [[x + 10, y + 10], [x + 30, y + 10], [x + 20, y + 20], [x + 12, y + 30], [x + 28, y + 30]]


class TestPrepare(unittest.TestCase):
    def test_exif_rotation_is_applied(self):
        self.assertEqual(app.prepare(jpeg(200, 100, orientation=6)).shape, (200, 100, 3))

    def test_downscales_to_1600(self):
        self.assertEqual(app.prepare(jpeg(4000, 3000, fmt="PNG")).shape, (1200, 1600, 3))

    def test_never_enlarges(self):
        self.assertEqual(app.prepare(jpeg(300, 200)).shape, (200, 300, 3))

    def test_unreadable_image_raises(self):
        with self.assertRaises(ValueError):
            app.prepare(b"not an image")


class TestDetect(unittest.TestCase):
    def test_input_side_never_enlarges(self):
        self.assertEqual(app.input_side(300, 200), 320)
        self.assertEqual(app.input_side(600, 900), 1024)
        self.assertEqual(app.input_side(1600, 1200), 1024)
        self.assertEqual(app.input_side(500, 512), 512)

    def test_border_retry_shifts_boxes_back(self):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        pad = 40
        padded_shape = (100 + 2 * pad, 100 + 2 * pad)
        det = FakeDetector({padded_shape: [([pad + 10, pad + 20, pad + 60, pad + 80], 0.9, kps_at(pad + 10, pad + 20))]})
        found = app.detect(img, det)
        self.assertEqual(len(found), 1)
        box, score, kps = found[0]
        self.assertEqual([round(v) for v in box], [10, 20, 60, 80])
        self.assertEqual([round(v) for v in kps[0]], [20, 30])
        self.assertEqual(len(det.sizes), 2)

    def test_no_retry_when_a_face_is_found(self):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        det = FakeDetector({(100, 100): [([10, 20, 60, 80], 0.9, kps_at(10, 20))]})
        self.assertEqual(len(app.detect(img, det)), 1)
        self.assertEqual(det.sizes, [(320, 320)])


class TestAnalyse(unittest.TestCase):
    def setUp(self):
        self.models = app.models
        two = [([10, 10, 40, 40], 0.9, kps_at(10, 10)), ([100, 50, 180, 150], 0.8, kps_at(100, 50))]
        app.models = (FakeDetector({(200, 300): two}), FakeRecogniser())

    def tearDown(self):
        app.models = self.models

    def test_photo_mode_returns_every_face_with_unit_embeddings(self):
        out = app.analyse(jpeg(300, 200), "photo")
        self.assertEqual((out["model"], out["width"], out["height"]), ("buffalo_l/w600k_r50", 300, 200))
        self.assertEqual([f["size"] for f in out["faces"]], [30, 80])
        vec = np.frombuffer(base64.b64decode(out["faces"][0]["embedding"]), dtype="<f4")
        self.assertEqual(vec.shape, (512,))
        self.assertAlmostEqual(float(np.linalg.norm(vec)), 1.0, places=5)
        self.assertAlmostEqual(float(vec[1]), 0.8, places=5)

    def test_portrait_mode_returns_largest_face_only(self):
        out = app.analyse(jpeg(300, 200), "portrait")
        self.assertEqual(len(out["faces"]), 1)
        self.assertEqual(out["faces"][0]["box"], [100.0, 50.0, 180.0, 150.0])

    def test_unexpected_error_is_a_500(self):
        real = app.analyse
        def broken(data, mode):
            raise RuntimeError("boom")
        app.analyse = broken
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/faces", data=b"x", method="POST")
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(req)
            self.assertEqual(caught.exception.code, 500)
            self.assertEqual(json.loads(caught.exception.read()), {"error": "analysis failed"})
        finally:
            app.analyse = real
            server.shutdown()

    def test_huge_image_is_unreadable_not_a_crash(self):
        limit = app.Image.MAX_IMAGE_PIXELS
        app.Image.MAX_IMAGE_PIXELS = 1000          # stand-in for a decompression bomb, without allocating one
        try:
            with self.assertRaises(ValueError):
                app.prepare(jpeg(100, 100))
        finally:
            app.Image.MAX_IMAGE_PIXELS = limit

    def test_http_handler(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            health = json.loads(urllib.request.urlopen(base + "/health").read())
            self.assertEqual(health, {"ok": True, "model": "buffalo_l/w600k_r50"})
            req = urllib.request.Request(base + "/faces?mode=photo", data=jpeg(300, 200), method="POST")
            self.assertEqual(len(json.loads(urllib.request.urlopen(req).read())["faces"]), 2)
            bad = urllib.request.Request(base + "/faces?mode=photo", data=b"junk", method="POST")
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(bad)
            self.assertEqual(caught.exception.code, 400)
            self.assertEqual(json.loads(caught.exception.read()), {"error": "unreadable image"})
        finally:
            server.shutdown()


class TestConcurrency(unittest.TestCase):
    def test_one_analysis_at_a_time(self):
        import time
        active, peak = [0], [0]
        real = app.analyse

        def slow(data, mode):
            active[0] += 1
            peak[0] = max(peak[0], active[0])
            time.sleep(0.2)
            active[0] -= 1
            return {"model": app.MODEL, "width": 1, "height": 1, "faces": []}

        app.analyse = slow
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/faces?mode=photo"
        try:
            calls = [threading.Thread(target=lambda: urllib.request.urlopen(urllib.request.Request(url, data=b"x", method="POST")).read())
                     for _ in range(3)]
            for c in calls: c.start()
            for c in calls: c.join()
        finally:
            app.analyse = real
            server.shutdown()
        self.assertEqual(peak[0], 1)


@unittest.skipUnless(os.path.isdir(os.environ.get("FACE_MODELS", "/models")), "model files not present")
class TestRealModels(unittest.TestCase):
    def test_blank_image_has_no_faces(self):
        app.models = app.load_models(os.environ.get("FACE_MODELS", "/models"))
        self.assertEqual(app.analyse(jpeg(640, 480), "photo")["faces"], [])


if __name__ == "__main__":
    unittest.main()
