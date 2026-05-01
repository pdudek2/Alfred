import { createApp } from "../apps/api/src/app";

type FetchableApp = {
  fetch(request: Request): Response | Promise<Response>;
};

let app: FetchableApp | undefined;

export function handleRequest(request: Request) {
  app ??= createApp();

  return app.fetch(request);
}
