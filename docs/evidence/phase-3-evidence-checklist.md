# Phase 3 Evidence Checklist

Use this checklist while executing and demoing the Phase 3 ML inference service. Redact bucket names you treat as sensitive, raw ID tokens, GCS signed URLs with embedded credentials, and any service account JSON before sharing screenshots. Status values separate code/config readiness from live model evidence that still needs to be captured.

## Requirement Coverage

| Item | Evidence needed | Status |
|------|-----------------|--------|
| `ML-01` | Cloud Run container log line "Loading MegaDetector from ..." + "Loading SpeciesNet from ..." + "Inference service ready" with non-zero model file sizes, AND a `/inference` `200 OK` response on at least one supplied `test_images/*.JPG` that returns at least one detection with a valid species_key | Deployed; capture live model evidence |
| `ML-02` | Cloud Run service detail screenshot showing `MODEL_PATH_MD`, `MODEL_PATH_SPECIES`, `LABELS_PATH`, `MODEL_VERSION_MD`, `MODEL_VERSION_SPECIES` in the env vars panel + a `git grep` showing the same identifiers come from env, never hardcoded | Code verified; capture live console evidence |
| `ML-03` | `/inference` response body shows the `model_version` field containing the configured combined version string (e.g. `speciesnet-au-v1+mdv5a-v1`); the AWS processor/API stores this value on `media.modelVersion` | Code verified; capture live API evidence |

## Decision Coverage

| Decision | Evidence | Status |
|----------|----------|--------|
| `D3-01..03` | `services/inference/Dockerfile` uses `python:3.11-slim` + `libgl1`; `pyproject.toml` lists `fastapi`, `uvicorn`, `torch==2.4.1+cpu` (already committed) | Done |
| `D3-04` | `services/inference/scripts/deploy-cloudrun.sh` uses `--allow-unauthenticated` for AWS Lambda reachability, sets `INFERENCE_AUTH_MODE=api_key`, and can mount `INFERENCE_API_KEY` from Secret Manager via `INFERENCE_API_KEY_SECRET` (already committed) | Done |
| `D3-05` | `services/inference/src/inference/main.py` honors `INFERENCE_AUTH_MODE=open|iam|api_key`, logs a `WARNING` on `open`, and requires `X-Inference-Api-Key` in `api_key` mode (already committed) | Done |
| `D3-06..D3-09` | `/health` and `/inference` shapes documented in `docs/contracts/api-contract.md` and implemented in `services/inference/src/inference/main.py` (already committed) | Done |
| `D3-10` | `services/inference/src/inference/labels.py` parses 46 rows; unit test asserts row 0 = `Alectura_lathami` and row 2 = `Bos_taurus` / cattle (already verified) | Done |
| `D3-11..D3-13` | Lifespan-managed model load in `main.py`; deploy script sets `--memory 4Gi --cpu 2 --startup-cpu-boost`; `MODEL_VERSION_*` echoed verbatim (already committed) | Done |
| `D3-14` | `services/inference/scripts/classify_test_images.py` walks `test_images/` and writes JSONL evidence; refuses non-open services (already committed) | Done |
| `D3-15` | `.env.example` defaults `MODEL_PATH_MD=./AussieEcoLense/mdv5a.pt` for local-dev (already committed) | Done |
| `D3-16..D3-20` | Deploy script targets `arched-vigil-490915-f7` + `australia-southeast1` + Artifact Registry `cloudeco`; creates SA + grants `storage.objectViewer` (already committed) | Done |
| `D3-21` | Folder layout verifiable via `tree services/inference/` | Done |
| `D3-22..D3-24` | Phase 3 commits stage only `services/inference/**` and `docs/**`; no `.planning/`, `.codex/`, `.claude/`; no `git push`; no billable action executed by automation | Done |

## API Proof Checklist

| Proof | Command or location | Expected |
|-------|---------------------|----------|
| Health endpoint (local, models loaded) | `curl http://localhost:8080/health` | `200`, `{"ok":true,"service":"inference","models_loaded":true,"auth_mode":"open","version":"0.1.0"}` |
| Inference local — known species | `python scripts/classify_test_images.py --limit 3` against the supplied `test_images/` | At least 1 of 3 images returns a top-1 prediction whose `species` matches the expected file-name species (e.g. `Bos_taurus_1.JPG` → `Bos_taurus`) |
| Inference local — empty detection | `POST /inference` with an image containing no animals | `200`, `detections: []` (NOT an error) |
| Inference local — bad image source | `POST /inference` with `{"image": {}}` | `422` Pydantic validation error |
| Inference local — multiple image fields | `POST /inference` with both `gcs_uri` and `url` set | `422` (XOR rule) |
| Cloud Run health smoke | `curl <service-url>/health` | `200` with `auth_mode:"api_key"` |
| Cloud Run timeout setting | Cloud Run service detail page or `gcloud run services describe ... --format='value(spec.template.spec.timeoutSeconds)'` | `300` seconds |
| Cloud Run demo warm instance | Cloud Run service detail page or `gcloud run services describe ... --format='value(spec.template.metadata.annotations.autoscaling.knative.dev/minScale)'` before live demo | `1` during demo window, then reset to `0` after demo |
| Cloud Run inference smoke (missing key) | `curl -X POST <service-url>/inference -H "Content-Type: application/json" -d '{"image":{"url":"https://example/sample.jpg"}}'` | `401` with `invalid_inference_api_key` |
| Cloud Run inference smoke (valid key) | `curl -X POST <service-url>/inference -H "X-Inference-Api-Key: <redacted>" -H "Content-Type: application/json" -d '{"image":{"url":"https://example/sample.jpg"}}'` | `200` if models are loaded and the image is fetchable, or a documented image-fetch/model readiness error |
| Cloud Run logs | Cloud Logging viewer filtered to the inference service | "Loading MegaDetector" / "Loading SpeciesNet" / "Inference service ready" startup lines + per-request access log |

## Test Images Run

Once the local service is running with `INFERENCE_AUTH_MODE=open`, run:

```powershell
python services\inference\scripts\classify_test_images.py `
  --service-url http://localhost:8080 `
  --images-dir .\test_images `
  --output .\services\inference\evidence\inference-results.jsonl
```

Expected: the script writes one JSONL line per image and prints a top-1 species histogram. The histogram should include the expected species from the test-image filenames (`Alectura_lathami`, `Bos_taurus`, `Felis_catus`, `Canis_familiaris`, `Casuarius_casuarius`, etc.) with high confidence.

Save the JSONL file as Phase 3 evidence. **Do not commit it** unless the team explicitly agrees; some teams treat raw model outputs as private.

## Cloud Run Configuration Screenshots

- [ ] Cloud Run service detail page showing memory `4Gi`, CPU `2`, concurrency `4`, timeout `300s`, max-instances `3`, `--allow-unauthenticated`, startup-cpu-boost ON.
- [ ] During the live demo window, Cloud Run service detail page or `gcloud` output showing min-instances `1`; after the demo, evidence that it was reset to `0`.
- [ ] Service account binding panel (Cloud Run uses `aussie-ecolens-inference-sa@...`).
- [ ] Service account IAM page showing `roles/storage.objectViewer` on `gs://aussie-ecolens-models`.
- [ ] Cloud Run env vars/secrets panel listing every `MODEL_*`, `INFERENCE_AUTH_MODE=api_key`, Secret Manager-backed `INFERENCE_API_KEY`, and `LOG_LEVEL=INFO`.
- [ ] Artifact Registry page showing the pushed `aussie-ecolens-inference` image with both `:latest` and the timestamped tag.
- [ ] GCS bucket `aussie-ecolens-models` page showing the `v1/` prefix with `mdv5a.pt`, `speciesnet-au-v1.pt`, `labels.txt`.

## Redaction Notes

- Do not screenshot raw API keys, ID tokens, or `gcloud auth print-identity-token` output.
- Do not screenshot service account JSON or impersonation token output.
- Redact GCS signed URLs (anything containing `?X-Goog-Algorithm=...`) — those embed credentials.
- Redact the project number `506288567902` if the team treats it as sensitive (the project ID `arched-vigil-490915-f7` alone is usually fine to show).
- Test image filenames in `evidence/inference-results.jsonl` include species names that may identify recording sites — confirm with the assignment supervisor before sharing publicly.
- Avoid exposing the full Cloud Run service URL in public screenshots; the hostname embeds the project + region.
