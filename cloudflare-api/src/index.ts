import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class AzalasApi extends Container {
  defaultPort = 8000;
  sleepAfter = "30m";

  envVars = {
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET,
    CORS_ORIGINS: env.CORS_ORIGINS,

    STORAGE_DRIVER: env.STORAGE_DRIVER ?? "r2",
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT_URL: env.R2_ENDPOINT_URL,
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_BUCKET: env.R2_BUCKET,
    R2_PUBLIC_BASE_URL: env.R2_PUBLIC_BASE_URL ?? "",
    R2_SIGNED_URL_EXPIRE_SECONDS: env.R2_SIGNED_URL_EXPIRE_SECONDS ?? "300",
    MAX_UPLOAD_MB: env.MAX_UPLOAD_MB ?? "10",
    ALLOWED_IMAGE_TYPES: env.ALLOWED_IMAGE_TYPES ?? "image/jpeg,image/png,image/webp",
    UPLOAD_DIR: env.UPLOAD_DIR ?? "uploads",
  };
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const container = getContainer(env.AZALAS_API, "azalas-api-v3");
    return container.fetch(request);
  },
};