FROM python:3.11-slim

# System deps required by megadetector / opencv-python-headless / Pillow.
# libgl1 and libglib2.0-0 satisfy the dynamic-linker checks; ca-certificates
# lets google-cloud-storage talk to TLS endpoints.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt /app/requirements.txt

# Use the official PyTorch CPU wheel index so torch+torchvision pull the CPU
# build instead of the (much larger) CUDA build.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r /app/requirements.txt

# The supplied SpeciesNet .pt pickle references onnx2torch classes.  The model
# only needs those class definitions at torch.load time; installing without
# dependencies avoids a protobuf resolver conflict with MegaDetector's pinned
# ultralytics-yolov5 dependency.
RUN pip install --no-deps protobuf==3.20.3 onnx==1.14.1 onnx2torch==1.5.15

COPY src /app/src
ENV PYTHONPATH=/app/src

# Cloud Run sends SIGTERM on shutdown; uvicorn handles it cleanly.
CMD ["sh", "-c", "exec uvicorn inference.main:app --host 0.0.0.0 --port \"${PORT}\" --workers 1"]
