import { z } from "zod";

const configSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]),
  host: z.string().min(1),
  port: z.number().int().positive(),
  webOrigin: z.string().url(),
  sqlitePath: z.string().min(1),
  sessionSecret: z.string().min(12),
  logLevel: z.string().min(1)
});

export type ServerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const port = Number(env.PORT ?? env.API_PORT ?? 3000);

  return configSchema.parse({
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port,
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:18081",
    sqlitePath: env.SQLITE_PATH ?? ".data/sengoku.sqlite",
    sessionSecret: env.SESSION_SECRET ?? "development-only-change-me",
    logLevel: env.LOG_LEVEL ?? "info"
  });
}
