# Tessera as one container: the built UI served by the FastAPI app.
#
# derivlab (option analytics) lives in the sibling project, so the build context is the
# QuantProjects folder:   docker build -f 06-financial-terminal/Dockerfile -t tessera ..
# (`make docker` runs exactly that.) Without project 05 the image still works; OMON and IVOL
# then report that option analytics are not configured.

FROM node:24-alpine AS web
WORKDIR /src
COPY 06-financial-terminal/frontend/package.json 06-financial-terminal/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY 06-financial-terminal/frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TESSERA_STATIC_DIR=/app/static \
    TESSERA_CACHE_DIR=/data/cache
WORKDIR /app
COPY 05-derivatives-pricing-lab/backend /deps/derivlab
COPY 06-financial-terminal/backend /deps/tessera
RUN pip install /deps/derivlab /deps/tessera && rm -rf /deps
COPY --from=web /src/dist /app/static
RUN useradd --create-home --uid 10001 tessera && mkdir -p /data/cache && chown -R tessera /data
USER tessera
VOLUME ["/data"]
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/api/health', timeout=4)"
CMD ["uvicorn", "tessera_api.main:app", "--host", "0.0.0.0", "--port", "8010", "--proxy-headers", "--workers", "1"]
