import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";

serve({
  fetch: createApp().fetch,
  port: env.API_PORT,
});

console.log(`Alfred API listening on :${env.API_PORT}`);
