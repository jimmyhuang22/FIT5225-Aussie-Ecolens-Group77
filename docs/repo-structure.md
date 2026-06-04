# Repository Structure

## Current Repository Structure

| Path | Purpose | Safe to sync to team repo? |
|------|---------|----------------------------|
| `README.md` | Current project overview, deployment pointers, and verification notes | Yes |
| `docs/architecture/` | Cloud/service responsibility map and future architecture docs | Yes |
| `docs/contracts/` | Current AWS API, inference, metadata, and environment contracts | Yes |
| `docs/evidence/` | Evidence checklists (Phase 1 + Phase 2 + Phase 3) and redacted proof inventory | Yes |
| `services/auth-proof/` | Cognito-to-GCP protected endpoint service; extended in Phase 2 with `/api/me`, CORS, and reusable auth middleware | Yes, excluding `node_modules` and `.env` |
| `services/auth-proof/src/middleware/` | Reusable Express middleware (Cognito JWT auth). Future protected routes wrap their handlers here. | Yes |
| `services/inference/` | Phase 3 ML inference service (Python FastAPI + MegaDetector + SpeciesNet). Cloud Run target. Internal to the app; deployed public at the Cloud Run layer and protected by `INFERENCE_AUTH_MODE=api_key`. | Yes, excluding `.venv`, `__pycache__`, `evidence`, `.env`, and any `.pt` files |
| `apps/web/` | React/Vite frontend with Amplify Auth, media workspace, subscriptions, query, delete, and bulk tag UI; deployed to GCS | Yes, excluding `node_modules`, `dist`, and `.env` |
| `.planning/` | GSD planning artifacts (local AI orchestration only — NOT pushed to team repo) | Local-only per Phase 2 commit policy |
| `.codex/` | Local Codex/GSD skill state | Local-only per Phase 2 commit policy |
| `.claude/` | Local Claude Code skill state | Local-only per Phase 2 commit policy |

## Superseded Planning Paths

| Path | Current note |
|------|--------------|
| `frontend/` | Superseded by `apps/web/` |
| `services/upload/` | Superseded by `services/aws-api/` and `services/aws-processor/` |
| `services/query/` | Superseded by `services/aws-api/` |
| `services/api/` | Not used; protected API routes live in `services/aws-api/` |
| `infra/` | Current SAM infrastructure lives in `infra/aws-sam/` |
| `docs/report/` | Reserved for redacted report assets, architecture diagram source, and demo notes |

## Local Coursework Materials

Do not blindly commit these files to the team GitHub repo:

- `FIT5225 2026 S1 A2.pdf`
- `AussieEcoLense.zip`
- `test_images.zip`
- `AussieEcoLense/model.pt`
- `AussieEcoLense/mdv5a.pt`
- Any other large model binaries, archive files, screenshots with sensitive values, or generated outputs.

The model binaries and test images are useful locally, but they may be too large or unsuitable for normal git history. If the team wants them in the repo, decide intentionally whether to use Git LFS, cloud storage, or a documented download step.

## Handoff Rules

1. Sync `README.md`, `docs/`, `services/auth-proof/`, `services/inference/`, and `apps/web/` first.
2. Keep `.env`, `.env.local`, tokens, and service account files out of git.
3. Preserve `.env.example` so teammates know which values to configure.
4. Use the same endpoint and field names from `docs/contracts` in later code.
5. Keep evidence redacted before adding screenshots to docs or reports.
6. Phase 2 commits exclude `.planning/`, `.codex/`, and `.claude/` — those directories hold local AI orchestration artifacts and are not part of the assignment deliverable. The team GitHub repo should see only the implementation, contracts, and evidence.

## Team GitHub Sync Notes

The team repository was README-only when this workspace was initialized. A safe first push/copy should include:

- `README.md`
- `.gitignore`
- `docs/architecture/service-map.md`
- `docs/contracts/api-contract.md`
- `docs/contracts/env-contract.md`
- `docs/contracts/metadata-schema.md`
- `docs/evidence/phase-1-evidence-checklist.md`
- `docs/evidence/phase-2-evidence-checklist.md`
- `docs/evidence/phase-3-evidence-checklist.md`
- `docs/repo-structure.md`
- `services/auth-proof/`
- `services/inference/` (excluding `.venv`, `__pycache__`, `evidence`, `.env`, and any `.pt` files)
- `apps/web/` (excluding `node_modules`, `dist`, `.env`)

Avoid copying `node_modules`, local `.env` files, zip archives, model binaries (`*.pt`, `*.pth`, `*.onnx`), Python virtualenvs (`.venv/`), and any `evidence/inference-results.jsonl` outputs that may contain test image filenames you treat as sensitive.
