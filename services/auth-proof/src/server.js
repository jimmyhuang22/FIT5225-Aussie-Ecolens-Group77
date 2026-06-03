const express = require("express");
const cors = require("cors");
const { requireCognitoAuth } = require("./middleware/requireCognitoAuth");
const { getIssuer } = require("./cognitoVerifier");

const app = express();
const port = Number(process.env.PORT || 8080);

app.disable("x-powered-by");

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

function parseAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw || !raw.trim()) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const allowedOrigins = parseAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("origin_not_allowed"));
    },
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "auth-proof",
  });
});

app.get("/protected/whoami", requireCognitoAuth, (req, res) => {
  const c = req.cognitoClaims;
  return res.json({
    authenticated: true,
    provider: "aws-cognito",
    runtime: "gcp-cloud-run",
    claims: {
      sub: c.sub,
      username: c.username || c["cognito:username"],
      email: c.email,
      token_use: c.token_use,
      iss: c.iss || getIssuer(),
    },
  });
});

app.get("/api/me", requireCognitoAuth, (req, res) => {
  const c = req.cognitoClaims;
  return res.json({
    user: {
      sub: c.sub,
      username: c.username || c["cognito:username"] || null,
      email: c.email || null,
      given_name: c.given_name || null,
      family_name: c.family_name || null,
      token_use: c.token_use,
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({
    error: "not_found",
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`auth-proof listening on port ${port}`);
  });
}

module.exports = app;
