#!/usr/bin/env bash
# Enable the GCP APIs the inference service needs.
#
# BILLABLE: enabling these APIs may cause charges if the project leaves the
# free tier. Review and run by hand.
#
# Usage:
#   bash services/inference/scripts/enable-apis.sh
#
# Override via env:
#   GCP_PROJECT_ID    (default: arched-vigil-490915-f7)

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Enable GCP APIs required by the Aussie EcoLens inference service.

Usage:
  bash services/inference/scripts/enable-apis.sh

Env overrides:
  GCP_PROJECT_ID    GCP project (default: arched-vigil-490915-f7)

APIs enabled:
  - run.googleapis.com              (Cloud Run)
  - storage.googleapis.com          (GCS for model bucket)
  - cloudbuild.googleapis.com       (Cloud Build, used by gcloud run deploy --source)
  - artifactregistry.googleapis.com (Container image registry)

Billable: enabling APIs is required before the related billable services can run.
USAGE
  exit 0
fi

PROJECT="${GCP_PROJECT_ID:-arched-vigil-490915-f7}"

cat <<BANNER
============================================================
 Enable APIs for inference service
 Project: ${PROJECT}
 APIs: run, storage, cloudbuild, artifactregistry
 NOTE: This is a billable action prerequisite. Review before running.
============================================================
BANNER

set -x
gcloud services enable \
  run.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="${PROJECT}"
set +x

echo "Done. APIs enabled on project ${PROJECT}."
