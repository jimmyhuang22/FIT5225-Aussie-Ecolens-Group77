#!/usr/bin/env bash
# Build the inference service Docker image (linux/amd64) and push to
# Artifact Registry.
#
# BILLABLE: storage in Artifact Registry. The image is ~1.3 GB compressed.
#
# Usage:
#   bash services/inference/scripts/build-image.sh
#
# Env overrides:
#   GCP_PROJECT_ID  (default: arched-vigil-490915-f7)
#   GCP_REGION      (default: australia-southeast1)
#   REPO            (default: cloudeco)
#   IMAGE           (default: aussie-ecolens-inference)
#   TAG             (default: timestamped UTC)

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Build + push the Aussie EcoLens inference container image.

Usage:
  bash services/inference/scripts/build-image.sh

Env overrides:
  GCP_PROJECT_ID   (default: arched-vigil-490915-f7)
  GCP_REGION       (default: australia-southeast1)
  REPO             (default: cloudeco)
  IMAGE            (default: aussie-ecolens-inference)
  TAG              (default: <UTC timestamp>)

Pushes two tags:
  ${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE}:${TAG}
  ${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE}:latest

Requires: docker (with buildx) + gcloud + Artifact Registry repo already exists.
Billable: Artifact Registry storage. Build time depends on network speed.
USAGE
  exit 0
fi

PROJECT="${GCP_PROJECT_ID:-arched-vigil-490915-f7}"
REGION="${GCP_REGION:-australia-southeast1}"
REPO="${REPO:-cloudeco}"
IMAGE="${IMAGE:-aussie-ecolens-inference}"
TAG="${TAG:-$(date -u +%Y%m%d-%H%M%S)}"

REGISTRY="${REGION}-docker.pkg.dev"
FULL="${REGISTRY}/${PROJECT}/${REPO}/${IMAGE}:${TAG}"
LATEST="${REGISTRY}/${PROJECT}/${REPO}/${IMAGE}:latest"

cat <<BANNER
============================================================
 Build + push inference image
 Project: ${PROJECT}
 Registry: ${REGISTRY}
 Repo: ${REPO}
 Image: ${IMAGE}
 Tag: ${TAG}
 Full: ${FULL}
============================================================
BANNER

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "${SCRIPT_DIR}")"

set -x
gcloud auth configure-docker "${REGISTRY}" --quiet --project="${PROJECT}"
docker buildx build \
  --platform linux/amd64 \
  -t "${FULL}" \
  -t "${LATEST}" \
  --push \
  "${SERVICE_DIR}"
set +x

cat <<RESULT
Done. Pushed:
  ${FULL}
  ${LATEST}

Next: bash services/inference/scripts/deploy-cloudrun.sh
RESULT
