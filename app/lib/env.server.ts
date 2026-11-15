import { existsSync } from "node:fs";

// Vite only puts VITE_-prefixed values from .env on process.env, so server
// secrets are loaded from .env here, once, the first time one is read. Values
// already in the environment win.
let loaded = false;

export function serverEnv(name: string): string | undefined {
  if (!loaded) {
    loaded = true;
    if (existsSync(".env")) process.loadEnvFile(".env");
  }
  const value = process.env[name];
  return value ? value : undefined;
}
