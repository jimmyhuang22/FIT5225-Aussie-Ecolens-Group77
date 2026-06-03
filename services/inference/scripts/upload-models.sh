#!/usr/bin/env bash
# Upload MegaDetector + SpeciesNet + labels.txt to a GCS bucket so the Cloud
# Run inference service can fetch them at startup.
#
# BILLABLE: bucket creation incurs minimal cost; the ~471 MB upload counts as
# egress from your machine + storage in australia-southeast1.
#
# Usage:
#   bash services/inference/scripts/upload-models.sh
#
# Env overrides:
#   GCP_PROJECT_ID  (default: arched-vigil-490915-f7)
#   MODEL_BUCKET    (default: aussie-ecolens-models)
#   GCP_REGION      (default: australia-southeast1)
#   MODEL_VERSION   (default: v1)
#   MODEL_SRC_DIR   (default: ./AussieEcoLense)

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Upload Aussie EcoLens model artifacts to GCS.

Usage:
  bash services/inference/scripts/upload-models.sh

Env overrides:
  GCP_PROJECT_ID    (default: arched-vigil-490915-f7)
  MODEL_BUCKET      (default: aussie-ecolens-models)
  GCP_REGION        (default: australia-southeast1)
  MODEL_VERSION     (default: v1)
  MODEL_SRC_DIR     (default: ./AussieEcoLense)

Result layout:
  gs://${MODEL_BUCKET}/${MODEL_VERSION}/mdv5a.pt              (~268 MB)
  gs://${MODEL_BUCKET}/${MODEL_VERSION}/speciesnet-au-v1.pt   (~203 MB)
  gs://${MODEL_BUCKET}/${MODEL_VERSION}/labels.txt            (~5 KB)

Billable: creates a GCS bucket (free tier covers small storage) and uploads
~471 MB of model weights. Egress from your machine is free; storage in
australia-southeast1 is on the standard price list.
USAGE
  exit 0
fi

PROJECT="${GCP_PROJECT_ID:-arched-vigil-490915-f7}"
BUCKET="${MODEL_BUCKET:-aussie-ecolens-models}"
LOCATION="${GCP_REGION:-australia-southeast1}"
MODEL_VERSION="${MODEL_VERSION:-v1}"
SRC_DIR="${MODEL_SRC_DIR:-./AussieEcoLense}"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "Error: MODEL_SRC_DIR not found: ${SRC_DIR}" >&2
  echo "Set MODEL_SRC_DIR to the directory containing mdv5a.pt, model.pt, labels.txt." >&2
  exit 2
fi

for f in mdv5a.pt model.pt labels.txt; do
  if [[ ! -f "${SRC_DIR}/${f}" ]]; then
    echo "Error: required file missing: ${SRC_DIR}/${f}" >&2
    exit 3
  fi
done

cat <<BANNER
============================================================
 Upload model artifacts to GCS
 Project:  ${PROJECT}
 Bucket:   gs://${BUCKET}  (location: ${LOCATION})
 Version:  ${MODEL_VERSION}
 Source:   ${SRC_DIR}
 NOTE: ~471 MB upload. Billable storage.
============================================================
BANNER

# Create bucket if missing
if ! gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Bucket gs://${BUCKET} does not exist. Creating..."
  set -x
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${LOCATION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
  set +x
else
  echo "Bucket gs://${BUCKET} already exists. Skipping create."
fi

PREFIX="gs://${BUCKET}/${MODEL_VERSION}"

set -x
gcloud storage cp "${SRC_DIR}/mdv5a.pt"   "${PREFIX}/mdv5a.pt"             --project="${PROJECT}"
gcloud storage cp "${SRC_DIR}/model.pt"   "${PREFIX}/speciesnet-au-v1.pt"  --project="${PROJECT}"
gcloud storage cp "${SRC_DIR}/labels.txt" "${PREFIX}/labels.txt"            --project="${PROJECT}"
set +x

cat <<RESULT

Done. Resulting URIs (use these on Cloud Run env):
  MODEL_PATH_MD=${PREFIX}/mdv5a.pt
  MODEL_PATH_SPECIES=${PREFIX}/speciesnet-au-v1.pt
  LABELS_PATH=${PREFIX}/labels.txt
RESULT
