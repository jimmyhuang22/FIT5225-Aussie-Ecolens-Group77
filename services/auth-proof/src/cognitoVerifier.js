const { CognitoJwtVerifier } = require("aws-jwt-verify");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

let verifier;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: requiredEnv("COGNITO_USER_POOL_ID"),
      tokenUse: process.env.COGNITO_TOKEN_USE || "access",
      clientId: requiredEnv("COGNITO_APP_CLIENT_ID"),
    });
  }
  return verifier;
}

async function verifyCognitoToken(token) {
  return getVerifier().verify(token);
}

function getIssuer() {
  const region = requiredEnv("COGNITO_REGION");
  const userPoolId = requiredEnv("COGNITO_USER_POOL_ID");
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

module.exports = {
  verifyCognitoToken,
  getIssuer,
};
