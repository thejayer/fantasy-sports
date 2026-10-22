import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVercelOidcToken = vi.fn(async () => "oidc-token");
const fromJSON = vi.fn((...args: unknown[]) => {
  void args;
  return { kind: "wif-client" };
});
const download = vi.fn();
const Storage = vi.fn(function Storage() {
  return {
    bucket(name: string) {
      return {
        file(objectKey: string) {
          return {
            download: () => download(name, objectKey),
          };
        },
      };
    },
  };
});

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: () => getVercelOidcToken(),
}));

vi.mock("google-auth-library", () => ({
  ExternalAccountClient: {
    fromJSON: (options: unknown) => fromJSON(options),
  },
}));

vi.mock("@google-cloud/storage", () => ({
  Storage,
}));

const GCS_ENV = {
  SJ_GCS_BUCKET: "test-bucket",
  GCP_PROJECT_ID: "test-project",
  GCP_WIF_AUDIENCE:
    "https://iam.googleapis.com/projects/0/locations/global/workloadIdentityPools/test-pool/providers/test-provider",
  GCP_SERVICE_ACCOUNT_EMAIL: "sa@example.invalid",
} as const;

const GCS_ENV_KEYS = Object.keys(GCS_ENV);

async function loadGcs() {
  vi.resetModules();
  return import("./gcs");
}

function setGcsEnv() {
  for (const [key, value] of Object.entries(GCS_ENV)) {
    process.env[key] = value;
  }
}

function clearGcsEnv() {
  for (const key of GCS_ENV_KEYS) {
    delete process.env[key];
  }
  delete process.env.SJ_DATA_SOURCE;
  delete process.env.SJ_GCS_PREFIX;
}

beforeEach(() => {
  clearGcsEnv();
  setGcsEnv();
  download.mockReset();
  fromJSON.mockClear();
  Storage.mockClear();
  getVercelOidcToken.mockClear();
});

afterEach(() => {
  clearGcsEnv();
});

describe("normalizeWifAudience", () => {
  it("accepts the console Default audience URL", async () => {
    const { normalizeWifAudience } = await loadGcs();
    expect(normalizeWifAudience(GCS_ENV.GCP_WIF_AUDIENCE)).toEqual({
      tokenAudience: GCS_ENV.GCP_WIF_AUDIENCE,
      stsAudience:
        "//iam.googleapis.com/projects/0/locations/global/workloadIdentityPools/test-pool/providers/test-provider",
    });
  });

  it("accepts a bare projects/ resource name", async () => {
    const { normalizeWifAudience } = await loadGcs();
    const { stsAudience, tokenAudience } = normalizeWifAudience(
      "projects/0/locations/global/workloadIdentityPools/test-pool/providers/test-provider",
    );
    expect(stsAudience).toBe(
      "//iam.googleapis.com/projects/0/locations/global/workloadIdentityPools/test-pool/providers/test-provider",
    );
    expect(tokenAudience).toBe(GCS_ENV.GCP_WIF_AUDIENCE);
  });
});

describe("buildWifAuthClient", () => {
  it("builds an external-account client with a Vercel OIDC supplier", async () => {
    const { buildWifAuthClient } = await loadGcs();
    const client = buildWifAuthClient();
    expect(client).toEqual({ kind: "wif-client" });
    expect(fromJSON).toHaveBeenCalledTimes(1);
    const config = fromJSON.mock.calls[0]?.[0] as unknown as {
      type: string;
      audience: string;
      subject_token_type: string;
      token_url: string;
      service_account_impersonation_url: string;
      subject_token_supplier: { getSubjectToken: () => Promise<string> };
    };
    expect(config).toBeTruthy();
    expect(config.type).toBe("external_account");
    expect(config.audience).toBe(
      "//iam.googleapis.com/projects/0/locations/global/workloadIdentityPools/test-pool/providers/test-provider",
    );
    expect(config.subject_token_type).toBe(
      "urn:ietf:params:oauth:token-type:jwt",
    );
    expect(config.token_url).toBe("https://sts.googleapis.com/v1/token");
    expect(config.service_account_impersonation_url).toBe(
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sa@example.invalid:generateAccessToken",
    );
    await expect(config.subject_token_supplier.getSubjectToken()).resolves.toBe(
      "oidc-token",
    );
    expect(getVercelOidcToken).toHaveBeenCalled();
  });

  it("names missing env vars instead of calling GCP", async () => {
    delete process.env.SJ_GCS_BUCKET;
    delete process.env.GCP_WIF_AUDIENCE;
    const { buildWifAuthClient } = await loadGcs();
    expect(() => buildWifAuthClient()).toThrow(
      /SJ_DATA_SOURCE=gcs requires SJ_GCS_BUCKET, GCP_WIF_AUDIENCE/,
    );
    expect(fromJSON).not.toHaveBeenCalled();
  });
});

describe("downloadGcsObject", () => {
  it("returns object text from the mocked Storage client", async () => {
    download.mockResolvedValue([Buffer.from('{"members":[]}')]);
    const { downloadGcsObject } = await loadGcs();
    await expect(downloadGcsObject("hub_members.json")).resolves.toBe(
      '{"members":[]}',
    );
    expect(Storage).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith("test-bucket", "hub_members.json");
  });

  it("treats 404 as missing (same as ENOENT)", async () => {
    const err = Object.assign(new Error("No such object"), { code: 404 });
    download.mockRejectedValue(err);
    const { downloadGcsObject } = await loadGcs();
    await expect(downloadGcsObject("bets/bets.json")).resolves.toBeNull();
  });

  it("rethrows auth and other errors", async () => {
    const err = Object.assign(new Error("forbidden"), { code: 403 });
    download.mockRejectedValue(err);
    const { downloadGcsObject } = await loadGcs();
    await expect(downloadGcsObject("hub_members.json")).rejects.toThrow(
      "forbidden",
    );
  });
});
