type FetchableApp = {
  fetch(request: Request): Response | Promise<Response>;
};

let appPromise: Promise<FetchableApp> | undefined;

export async function handleRequest(request: Request) {
  appPromise ??= import("../apps/api/src/app.js").then(({ createApp }) => createApp());
  const app = await appPromise;

  return app.fetch(request);
}
