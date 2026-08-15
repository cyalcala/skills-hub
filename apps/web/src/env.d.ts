/// <reference types="astro/client" />

import type { Runtime } from "@astrojs/cloudflare";

interface Env {
  DB: D1Database;
  PROXY_SECRET?: string;
  CRON_SECRET?: string;
}

declare global {
  namespace App {
    interface Locals extends Runtime<Env> {}
  }
}