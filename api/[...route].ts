import { createApp } from "../apps/api/src/app.js";

const app = createApp();

export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
};
