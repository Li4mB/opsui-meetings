import { google } from "googleapis";
import { env } from "../config/env.js";

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

const getGoogleCredentials = (): ServiceAccountCredentials => {
  if (!env.googleServiceAccountJson) {
    throw new Error("OPSUI_GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  }

  return JSON.parse(env.googleServiceAccountJson) as ServiceAccountCredentials;
};

export const createGoogleJwt = (scopes: string[]) => {
  const credentials = getGoogleCredentials();

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
  });
};
