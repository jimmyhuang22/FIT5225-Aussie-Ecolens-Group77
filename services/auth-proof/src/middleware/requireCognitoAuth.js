const { verifyCognitoToken } = require("../cognitoVerifier");

function extractBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function requireCognitoAuth(req, res, next) {
  const token = extractBearerToken(req.get("Authorization"));

  if (!token) {
    return res.status(401).json({ error: "missing_bearer_token" });
  }

  try {
    req.cognitoClaims = await verifyCognitoToken(token);
    return next();
  } catch (_error) {
    return res.status(403).json({ error: "invalid_token" });
  }
}

module.exports = {
  requireCognitoAuth,
  extractBearerToken,
};
