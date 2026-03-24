import { defineConfig } from "@caido-community/dev";

export default defineConfig({
  id: "reqres-exporter",
  name: "ReqRes Exporter",
  description: "Copy or save HTTP request+response pairs to clipboard or file with one click.",
  version: "1.0.0",
  author: {
    name: "Jakob Pachmann",
    email: "jakob.pachmann@proton.me",
  },
  plugins: [
    {
      kind: "frontend",
      id: "reqres-exporter-frontend",
      root: "plugin",
      backend: { id: "reqres-exporter-backend" },
    },
    {
      kind: "backend",
      id: "reqres-exporter-backend",
      root: "backend",
    },
  ],
});
