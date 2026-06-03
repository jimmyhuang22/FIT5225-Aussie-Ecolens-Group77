import { Amplify } from "aws-amplify";

const region = import.meta.env.VITE_COGNITO_REGION;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_COGNITO_APP_CLIENT_ID;

if (!region || !userPoolId || !userPoolClientId) {
  // eslint-disable-next-line no-console
  console.warn(
    "Missing one of VITE_COGNITO_REGION / VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_APP_CLIENT_ID. Sign-up and sign-in will fail until these are set in apps/web/.env."
  );
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: userPoolId ?? "",
      userPoolClientId: userPoolClientId ?? "",
      loginWith: {
        email: true,
      },
    },
  },
});

export const COGNITO_REGION = region ?? "";
