import { resolve } from "node:path";
import { Store } from "./store.js";
import { createApp } from "./app.js";
const store = new Store(
  resolve(process.env.AP_DATA_DIR ?? ".data", "analytics.sqlite"),
);
const { app, launch } = createApp(store);
const port = Number(process.env.PORT ?? 4310);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `Open this local session: http://127.0.0.1:${port}/launch?token=${launch}`,
  ),
);
process.on("SIGINT", () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
