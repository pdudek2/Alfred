import { createApp } from "../apps/api/src/app";

const app = createApp();

export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
};
