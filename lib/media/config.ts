export type MediaEnvironment = "development" | "test" | "staging" | "production";

export type MediaProviderConfig = Readonly<{
  kind: "local" | "s3-compatible";
  accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
  root?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  forcePathStyle?: boolean;
}>;

export type MediaStorageConfig = Readonly<{
  environment: MediaEnvironment;
  managedMediaIngestionEnabled: boolean;
  providers: Readonly<Record<string, MediaProviderConfig>>;
}>;

export function isManagedMediaIngestionEnabled(): boolean {
  return process.env.MANAGED_MEDIA_INGESTION_ENABLED === "true";
}

export function validateMediaStorageEnvironment(
  environment: MediaEnvironment,
  providers: Record<string, MediaProviderConfig>
): void {
  for (const [providerKey, provider] of Object.entries(providers)) {
    if (environment !== "production") {
      if (providerKey.startsWith("prod-") || providerKey.includes("prod")) {
        throw new Error(`PRODUCTION_PROVIDER_IN_NON_PROD: provider ${providerKey} is not permitted in ${environment}`);
      }
    } else {
      if (provider.kind === "local" || providerKey.startsWith("dev-") || providerKey.includes("local")) {
        throw new Error(`LOCAL_PROVIDER_IN_PRODUCTION: local provider ${providerKey} is not permitted in production`);
      }
    }
  }
}

export function getMediaStorageConfig(): MediaStorageConfig {
  const envRaw = (process.env.MEDIA_ENVIRONMENT || "development").toLowerCase();
  const environment: MediaEnvironment =
    envRaw === "production"
      ? "production"
      : envRaw === "staging"
      ? "staging"
      : envRaw === "test"
      ? "test"
      : "development";

  const privateKey = process.env.MEDIA_PRIVATE_PROVIDER_KEY || "dev-private-local-01";
  const publicKey = process.env.MEDIA_PUBLIC_PROVIDER_KEY || "dev-public-local-01";
  const privateRoot = process.env.MEDIA_PRIVATE_ROOT || ".local-media/private";
  const publicRoot = process.env.MEDIA_PUBLIC_ROOT || ".local-media/public";

  const providers: Record<string, MediaProviderConfig> = {
    [privateKey]: {
      kind: "local",
      accessClass: "PRIVATE_SOURCE",
      root: privateRoot,
    },
    [publicKey]: {
      kind: "local",
      accessClass: "PUBLIC_DELIVERY",
      root: publicRoot,
    },
  };

  validateMediaStorageEnvironment(environment, providers);

  return {
    environment,
    managedMediaIngestionEnabled: isManagedMediaIngestionEnabled(),
    providers,
  };
}
