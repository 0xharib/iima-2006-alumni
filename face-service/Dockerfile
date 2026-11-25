# Face service for automatic face tagging (see docs/operations.md, "Face tagging").
FROM python:3.12-slim

# insightface also installs opencv-python, which needs these system libraries.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# InsightFace buffalo_l models: non-commercial research licence. Only the detector and recogniser are kept.
RUN curl -fsSL -o /tmp/buffalo_l.zip https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip \
    && mkdir -p /models && unzip -j /tmp/buffalo_l.zip det_10g.onnx w600k_r50.onnx -d /models \
    && rm /tmp/buffalo_l.zip

COPY app.py .
ENV FACE_MODELS=/models PORT=8080
EXPOSE 8080
CMD ["python", "app.py"]
