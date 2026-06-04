<!-- GSD:project-start source:PROJECT.md -->
## Project

**Aussie EcoLens Assignment Workspace**

Aussie EcoLens is a FIT5225 2026 S1 Assignment 2 project: a multi-cloud serverless wildlife observation platform. The system must let authenticated users upload wildlife images and videos, automatically detect species with the provided model assets, store metadata, and retrieve media through tag-based queries and a simple web UI.

This workspace currently contains the official assignment PDF, a local model/demo package in `AussieEcoLense`, test images, and a link to the team GitHub repository at `https://github.com/jimmyhuang22/FIT5225-Aussie-EcoLens`. The remote repository currently only contains a README, so the immediate work is to turn the local materials into a buildable team implementation plan.

**Core Value:** Authenticated users can upload media and later find it by detected wildlife tags through a demonstrable multi-cloud serverless pipeline.

### Constraints

- **Authentication**: AWS Cognito is mandatory for auth/authz - assignment requirement.
- **Multi-cloud**: At least two major providers must perform real system roles - assignment requirement.
- **Serverless**: Core compute should be serverless or serverless-container based - assignment requirement.
- **Model size**: `model.pt` and `mdv5a.pt` are large, so inference may be better in a containerized serverless service rather than a small Lambda zip.
- **Demo risk**: No demo means no marks; all high-risk workflows need evidence and a practiced path.
- **Report limit**: Team report has a strict 1000-word limit, so tables, diagrams, screenshots, and concise prose matter.
- **Academic integrity**: GenAI use is allowed selectively but must be acknowledged responsibly.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
| Layer | Recommendation | Rationale |
|-------|----------------|-----------|
| Auth | AWS Cognito | Mandatory in the assignment and suitable for JWT-protected APIs |
| Public API | AWS API Gateway + Lambda | Fast path for protected REST endpoints and Cognito authorizers |
| Object storage | AWS S3 for uploads/thumbnails, optional GCP Cloud Storage for cross-cloud role | Native triggers, signed URLs, and clear demo evidence |
| Inference | GCP Cloud Run or AWS Lambda container image | Large PyTorch/MegaDetector dependencies are easier in containers |
| Database | DynamoDB or Firestore | Store media metadata, tag counts, user subscriptions, and model version |
| Notifications | AWS SNS | Direct fit for tag-based email updates |
| Frontend | React/Vite or simple static app hosted in S3/CloudFront | Quick protected UI with upload/query flows |
| IaC | Lightweight SAM/CDK/Terraform if time permits | Helps explain and reproduce the architecture, but manual screenshots are acceptable if time is tight |
## Notes
- Avoid packaging the large ML model directly into a small Lambda zip.
- Keep model bucket/key/version and thresholds outside source code.
- Design DB records around tag counts so `{"wombat": 2}` style queries are feasible.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| "gsa" | "Guided wrapper for StudyGSD GSA commands: $gsa, $gsa-new, $gsa-check, and $gsa-rev." | `.codex/skills/gsa/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
