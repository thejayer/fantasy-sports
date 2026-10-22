/**
 * Read-only GCS access for Vercel (SJ_DATA_SOURCE=gcs).
 * Auth is Vercel OIDC → GCP Workload Identity Federation → impersonated SA.
 * No JSON key files. Cloud Run / local keep SJ_DATA_SOURCE unset (fs).
 */

import { ExternalAccountClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";

const STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";

export const GCS_REQUIRED_ENV = [
  "SJ_GCS_BUCKET",
  "GCP_PROJECT_ID",
  "GCP_WIF_AUDIENCE",
  "GCP_SERVICE_ACCOUNT_EMAIL",
] as const;

type StorageLike = {
  bucket: (name: string) => {
    file: (name: string) => {
      download: () => Promise<[Buffer]>;
    };
  };
};

let storagePromise: Promise<StorageLike> | null = null;

export function resetGcsClientForTests(): void {
  storagePromise = null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`SJ_DATA_SOURCE=gcs requires ${name}`);
  }
  return value;
}

/**
 * Accept the WIF Default audience as copied from Google Cloud Console
 * (`https://iam.googleapis.com/projects/…/providers/…`) or the STS form
 * (`//iam.googleapis.com/…`) or a bare `projects/…` resource name.
 */
export function normalizeWifAudience(raw: string): {
  tokenAudience: string;
  stsAudience: string;
} {
  let path = raw.trim();
  if (!path) {
    throw new Error("SJ_DATA_SOURCE=gcs requires GCP_WIF_AUDIENCE");
  }
  path = path.replace(/^https:/, "");
  if (!path.startsWith("//iam.googleapis.com/")) {
    path = path.replace(/^\/+/, "");
    if (path.startsWith("iam.googleapis.com/")) {
      path = `//${path}`;
    } else if (path.startsWith("projects/")) {
      path = `//iam.googleapis.com/${path}`;
    } else {
      throw new Error("GCP_WIF_AUDIENCE is not a WIF provider audience");
    }
  }
  return {
    stsAudience: path,
    tokenAudience: `https:${path}`,
  };
}

export function missingGcsEnv(): string[] {
  return GCS_REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
}

export function buildWifAuthClient(): NonNullable<
  ReturnType<typeof ExternalAccountClient.fromJSON>
> {
  const missing = missingGcsEnv();
  if (missing.length) {
    throw new Error(`SJ_DATA_SOURCE=gcs requires ${missing.join(", ")}`);
  }
  const { stsAudience } = normalizeWifAudience(requireEnv("GCP_WIF_AUDIENCE"));
  const email = requireEnv("GCP_SERVICE_ACCOUNT_EMAIL");
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: stsAudience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: STS_TOKEN_URL,
    service_account_impersonation_url: `${IAM_CREDENTIALS}/${email}:generateAccessToken`,
    // Default Vercel OIDC `aud` is `https://vercel.com/<TEAM_SLUG>`. Configure
    // the WIF provider Allowed audiences to that value (no JSON key files).
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken(),
    },
  });
  if (!client) {
    throw new Error("Failed to build GCP WIF external-account client");
  }
  return client;
}

async function getStorage(): Promise<StorageLike> {
  if (!storagePromise) {
    storagePromise = (async () => {
      const { Storage } = await import("@google-cloud/storage");
      return new Storage({
        projectId: requireEnv("GCP_PROJECT_ID"),
        authClient: buildWifAuthClient(),
      });
    })();
  }
  try {
    return await storagePromise;
  } catch (err) {
    storagePromise = null;
    throw err;
  }
}

export function isMissingGcsObject(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === 404 || code === "404" || code === "ENOENT") return true;
  const status = (err as { status?: unknown }).status;
  return status === 404 || status === "404";
}

export async function downloadGcsObject(
  objectKey: string,
): Promise<string | null> {
  const bucket = requireEnv("SJ_GCS_BUCKET");
  const storage = await getStorage();
  try {
    const [buf] = await storage.bucket(bucket).file(objectKey).download();
    return buf.toString("utf8");
  } catch (err) {
    if (isMissingGcsObject(err)) return null;
    throw err;
  }
}
