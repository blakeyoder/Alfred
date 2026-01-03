import { sql } from "../db/client.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
}

function getClientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required"
    );
  }

  return { clientId, clientSecret };
}

/**
 * Initiates the Device Authorization flow.
 * Returns the user code and verification URL for the user to complete auth.
 */
export async function initiateDeviceFlow(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}> {
  const { clientId } = getClientCredentials();

  const response = await fetch(GOOGLE_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: SCOPES.join(" "),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to initiate device flow: ${error}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Polls for the authorization token after user completes the device flow.
 * Returns null if authorization is still pending, throws on error.
 */
export async function pollForToken(
  deviceCode: string
): Promise<TokenResponse | null> {
  const { clientId, clientSecret } = getClientCredentials();

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    if (data.error === "authorization_pending") {
      return null; // Still waiting for user
    }
    if (data.error === "slow_down") {
      return null; // Need to slow down polling
    }
    throw new Error(
      `Token exchange failed: ${data.error_description || data.error}`
    );
  }

  return data as TokenResponse;
}

/**
 * Stores encrypted tokens in the database.
 */
export async function storeTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  scopes: string[]
): Promise<void> {
  const accessTokenEncrypted = encrypt(accessToken);
  const refreshTokenEncrypted = encrypt(refreshToken);

  await sql`
    INSERT INTO google_tokens (user_id, access_token_encrypted, refresh_token_encrypted, expires_at, scopes, updated_at)
    VALUES (${userId}, ${accessTokenEncrypted}, ${refreshTokenEncrypted}, ${expiresAt}, ${scopes}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      access_token_encrypted = ${accessTokenEncrypted},
      refresh_token_encrypted = ${refreshTokenEncrypted},
      expires_at = ${expiresAt},
      scopes = ${scopes},
      updated_at = NOW()
  `;
}

/**
 * Retrieves decrypted tokens from the database.
 */
export async function getTokens(userId: string): Promise<StoredTokens | null> {
  const rows = await sql<
    {
      access_token_encrypted: string;
      refresh_token_encrypted: string;
      expires_at: Date;
      scopes: string[];
    }[]
  >`
    SELECT access_token_encrypted, refresh_token_encrypted, expires_at, scopes
    FROM google_tokens
    WHERE user_id = ${userId}
  `;

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    accessToken: decrypt(row.access_token_encrypted),
    refreshToken: decrypt(row.refresh_token_encrypted),
    expiresAt: row.expires_at,
    scopes: row.scopes,
  };
}

/**
 * Refreshes an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  userId: string
): Promise<string | null> {
  const tokens = await getTokens(userId);
  if (!tokens) {
    return null;
  }

  const { clientId, clientSecret } = getClientCredentials();

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Token refresh failed:", error);
    return null;
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await storeTokens(
    userId,
    data.access_token,
    tokens.refreshToken, // Refresh token stays the same
    expiresAt,
    tokens.scopes
  );

  return data.access_token;
}

/**
 * Gets a valid access token, refreshing if necessary.
 * Returns null if no tokens exist or refresh fails.
 */
export async function getValidAccessToken(
  userId: string
): Promise<string | null> {
  const tokens = await getTokens(userId);
  if (!tokens) {
    return null;
  }

  // Check if token is expired (with 5 min buffer)
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expiresAt.getTime() - bufferMs < Date.now()) {
    return refreshAccessToken(userId);
  }

  return tokens.accessToken;
}

/**
 * Checks if a user has Google tokens stored.
 */
export async function hasGoogleAuth(userId: string): Promise<boolean> {
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM google_tokens WHERE user_id = ${userId}
  `;
  return rows[0].count > 0;
}

/**
 * Removes Google tokens for a user.
 */
export async function revokeGoogleAuth(userId: string): Promise<void> {
  await sql`DELETE FROM google_tokens WHERE user_id = ${userId}`;
}

/**
 * Completes the device flow by polling until authorized.
 * Returns the tokens on success.
 */
export async function completeDeviceFlow(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onProgress?: (message: string) => void
): Promise<TokenResponse> {
  const startTime = Date.now();
  const timeoutMs = expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const result = await pollForToken(deviceCode);
      if (result) {
        return result;
      }
      onProgress?.("Waiting for authorization...");
    } catch (error) {
      if (error instanceof Error && error.message.includes("slow_down")) {
        pollInterval += 1000; // Back off
        continue;
      }
      throw error;
    }
  }

  throw new Error("Authorization timed out");
}
