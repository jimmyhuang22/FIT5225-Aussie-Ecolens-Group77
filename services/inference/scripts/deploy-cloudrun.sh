#!/usr/bin/env bash
# Deploy the inference container to Cloud Run with the locked flag set.
#
# BILLABLE: Cloud Run runtime + egress. For the assignment integration path, the
# service is public at Cloud Run but requires X-Inference-Api-Key on /inference.
#
# Usage:
#   bash services/inference/scripts/deploy-cloudrun.sh
#
# Env overrides:
#   GCP_PROJECT_ID   (default: arched-vigil-490915-f7)
#   GCP_REGION       (default: australia-southeast1)
#   REPO             (default: cloudeco)
#   IMAGE            (default: aussie-ecolens-inference)
#   TAG              (default: latest)
#   SERVICE          (default: aussie-ecolens-inference)
#   MODEL_BUCKET     (default: aussie-ecolens-models)
#   MODEL_VERSION    (default: v1)
#   INFERENCE_SA     (default: aussie-ecolens-inference-sa)
#   INFERENCE_API_KEY        (required unless INFERENCE_API_KEY_SECRET is set)
#   INFERENCE_API_KEY_SECRET (optional Secret Manager secret name)

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Deploy the Aussie EcoLens inference service to Cloud Run.

Usage:
  bash services/inference/scripts/deploy-cloudrun.sh

Env overrides:
  GCP_PROJECT_ID   (default: arched-vigil-490915-f7)
  GCP_REGION       (default: australia-southeast1)
  REPO             (default: cloudeco)
  IMAGE            (default: aussie-ecolens-inference)
  TAG              (default: latest)
  SERVICE          (default: aussie-ecolens-inference)
  MODEL_BUCKET     (default: aussie-ecolens-models)
  MODEL_VERSION    (default: v1)
  INFERENCE_SA     (default: aussie-ecolens-inference-sa)
  INFERENCE_API_KEY        (required unless INFERENCE_API_KEY_SECRET is set)
  INFERENCE_API_KEY_SECRET (optional Secret Manager secret name)

Locked flag set:
  --region australia-southeast1
  --allow-unauthenticated
  --memory 4Gi
  --cpu 2
  --concurrency 4
  --max-instances 3
  --timeout 60
  --cpu-boost
  --port 8080

Sets env vars on the service pointing at:
  MODEL_PATH_MD=gs://${MODEL_BUCKET}/${MODEL_VERSION}/mdv5a.pt
  MODEL_PATH_SPECIES=gs://${MODEL_BUCKET}/${MODEL_VERSION}/speciesnet-au-v1.pt
  LABELS_PATH=gs://${MODEL_BUCKET}/${MODEL_VERSION}/labels.txt
  MODEL_VERSION_MD=mdv5a-${MODEL_VERSION}
  MODEL_VERSION_SPECIES=speciesnet-au-${MODEL_VERSION}
  INFERENCE_AUTH_MODE=api_key
  INFERENCE_API_KEY=<provided from Secret Manager or env>
  LOG_LEVEL=INFO

Prerequisites:
  1. enable-apis.sh
  2. upload-models.sh
  3. build-image.sh

Billable: Cloud Run runtime + egress. Costs depend on traffic and cold-start
frequency. max-instances=3 caps blast radius. Keep the service min-instances at
0 to avoid idle CPU/memory charges.
USAGE
  exit 0
fi

PROJECT="${GCP_PROJECT_ID:-arched-vigil-490915-f7}"
REGION="${GCP_REGION:-australia-southeast1}"
REPO="${REPO:-cloudeco}"
IMAGE="${IMAGE:-aussie-ecolens-inference}"
TAG="${TAG:-latest}"
SERVICE="${SERVICE:-aussie-ecolens-inference}"
BUCKET="${MODEL_BUCKET:-aussie-ecolens-models}"
MODEL_VERSION="${MODEL_VERSION:-v1}"
SA_NAME="${INFERENCE_SA:-aussie-ecolens-inference-sa}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
API_KEY="${INFERENCE_API_KEY:-}"
API_KEY_SECRET="${INFERENCE_API_KEY_SECRET:-}"

FULL="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE}:${TAG}"
PREFIX="gs://${BUCKET}/${MODEL_VERSION}"

if [[ -z "${API_KEY}" && -z "${API_KEY_SECRET}" ]]; then
  echo "Error: INFERENCE_API_KEY or INFERENCE_API_KEY_SECRET is required for Cloud Run api_key mode." >&2
  echo "Prefer storing the key in Secret Manager and passing INFERENCE_API_KEY_SECRET." >&2
  exit 4
fi

cat <<BANNER
============================================================
 Deploy inference to Cloud Run
 Project: ${PROJECT}
 Region:  ${REGION}
 Service: ${SERVICE}
 Image:   ${FULL}
 SA:      ${SA_EMAIL}
 Models:  ${PREFIX}/
 NOTE: Billable. Verifies prerequisites have run first.
============================================================
BANNER

# 1. Ensure service account exists.
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Creating service account ${SA_EMAIL}..."
  set -x
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Aussie EcoLens Inference" \
    --project="${PROJECT}"
  set +x
else
  echo "Service account ${SA_EMAIL} already exists."
fi

# 2. Ensure SA can read the model bucket.
set -x
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectViewer" \
  --project="${PROJECT}" >/dev/null
set +x

if [[ -n "${API_KEY_SECRET}" ]]; then
  echo "Granting ${SA_EMAIL} access to Secret Manager secret ${API_KEY_SECRET}..."
  set -x
  gcloud secrets add-iam-policy-binding "${API_KEY_SECRET}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="${PROJECT}" >/dev/null
  set +x
fi

# 3. Deploy. Do not enable shell tracing here because legacy --set-env-vars may
# contain INFERENCE_API_KEY.
COMMON_ENV_VARS="MODEL_PATH_MD=${PREFIX}/mdv5a.pt,MODEL_PATH_SPECIES=${PREFIX}/speciesnet-au-v1.pt,LABELS_PATH=${PREFIX}/labels.txt,MODEL_VERSION_MD=mdv5a-${MODEL_VERSION},MODEL_VERSION_SPECIES=speciesnet-au-${MODEL_VERSION},INFERENCE_AUTH_MODE=api_key,LOG_LEVEL=INFO"

SECRET_FLAGS=()
if [[ -n "${API_KEY_SECRET}" ]]; then
  SECRET_FLAGS=(--update-secrets "INFERENCE_API_KEY=${API_KEY_SECRET}:latest")
else
  COMMON_ENV_VARS="${COMMON_ENV_VARS},INFERENCE_API_KEY=${API_KEY}"
fi

gcloud run deploy "${SERVICE}" \
  --image "${FULL}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --allow-unauthenticated \
  --service-account "${SA_EMAIL}" \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 4 \
  --max-instances 3 \
  --min-instances 0 \
  --timeout 60 \
  --cpu-boost \
  --port 8080 \
  --set-env-vars "${COMMON_ENV_VARS}" \
  "${SECRET_FLAGS[@]}"

URL="$(gcloud run services describe "${SERVICE}" --region="${REGION}" --project="${PROJECT}" --format='value(status.url)')"

cat <<RESULT

Deployed. Service URL:
  ${URL}

Smoke test:

  curl "${URL}/health"

  curl -X POST "${URL}/inference" \\
       -H "X-Inference-Api-Key: <redacted from INFERENCE_API_KEY or Secret Manager>" \\
       -H "Content-Type: application/json" \\
       -d '{"image":{"url":"https://example/sample.jpg"}}'
RESULT
