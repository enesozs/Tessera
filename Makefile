# Tessera — common tasks. Run from the project root.
PY := backend/.venv/bin
# Own ports so Tessera can run next to the other QuantProjects (which use 8000/5173).
API_PORT ?= 8010
WEB_PORT ?= 5180

# Optional local settings (e.g. SEC_USER_AGENT) are exported to the API.
-include .env
export

.PHONY: install dev api web test e2e lint check build serve docker docker-run

install:            ## Create the Python venv and install both halves
	python3 -m venv backend/.venv
	$(PY)/pip install -q --upgrade pip
	$(PY)/pip install -q -e "backend[dev]"
	# Option analytics (OMON, IVOL) use the pricing library from the sibling project 05.
	$(PY)/pip install -q -e ../05-derivatives-pricing-lab/backend
	cd frontend && npm install

dev:                ## API on :8010 + Vite on :5180 (open http://localhost:5180)
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) --no-print-directory api & \
	$(MAKE) --no-print-directory web & \
	wait

api:
	cd backend && .venv/bin/fastapi dev --port $(API_PORT)

web:
	cd frontend && npx vite --port $(WEB_PORT) --strictPort

test:               ## Backend (pytest) and frontend (vitest) unit tests — offline
	cd backend && .venv/bin/pytest -q
	cd frontend && npm test

e2e:                ## Browser smoke test against running dev servers (needs `make dev` + Chrome)
	$(PY)/python e2e/smoke.py http://localhost:$(WEB_PORT)

lint:               ## Format + lint + type-check both halves
	cd backend && .venv/bin/ruff format . ../e2e && .venv/bin/ruff check . ../e2e && .venv/bin/pyright
	cd frontend && npx tsc -b && npm run lint

check: lint test    ## Everything CI would run
	cd frontend && npm run build

build:              ## Production build of the frontend (served by FastAPI from frontend/dist)
	cd frontend && npm run build

serve: build        ## Single process: API + built UI on http://localhost:8010
	cd backend && .venv/bin/fastapi run --port $(API_PORT)

docker:             ## Build the single-container image (context: the QuantProjects folder)
	docker build -f Dockerfile -t tessera:latest ..

docker-run:         ## Run the image on http://localhost:8010 (cache in a named volume)
	docker run --rm -p 8010:8010 -v tessera-data:/data $(if $(SEC_USER_AGENT),-e SEC_USER_AGENT="$(SEC_USER_AGENT)") $(if $(ANTHROPIC_API_KEY),-e ANTHROPIC_API_KEY) tessera:latest
