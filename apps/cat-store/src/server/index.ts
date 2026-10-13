import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 20030);

createApp().listen(port, () => {
  console.log(`[cat-store] orders API listening on port ${port}`);
});
