# Tessera as one container: the built UI served by the FastAPI app.
#   docker build -t tessera .
#   docker run -p 8010:8010 tessera          → http://localhost:8010
# On Render (render.yaml), the platform sets $PORT and the same image runs unchanged.
#
# Option analytics (OMON, IVOL) use derivlab, the pricing library from the Derivatives Pricing
# Lab, installed from its GitHub repository. Override DERIVLAB to install it from elsewhere, or
# set it to an empty string to build without it (OMON and IVOL then explain how to enable it).

# --- 1. Build the web app ---------------------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- 2. Python runtime --------------------------------------------------------------------------
FROM python:3.13-slim
ARG DERIVLAB="derivlab @ https://github.com/enesozs/Derivatives-Pricing-Lab/archive/refs/heads/main.tar.gz#subdirectory=backend"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TESSERA_STATIC_DIR=/app/static \
    TESSERA_CACHE_DIR=/data/cache \
    PORT=8010
WORKDIR /app
COPY backend /tmp/tessera
RUN if [ -n "$DERIVLAB" ]; then pip install "$DERIVLAB"; fi \
 && pip install /tmp/tessera && rm -rf /tmp/tessera
COPY --from=web /src/dist /app/static
RUN useradd --create-home --uid 10001 tessera && mkdir -p /data/cache && chown -R tessera /data
USER tessera
VOLUME ["/data"]
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=4)"
CMD ["sh", "-c", "exec uvicorn tessera_api.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --workers 1"]
