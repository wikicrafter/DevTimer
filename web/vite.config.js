export default {
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the local server during development
      "/api": "http://localhost:8787"
    }
  },
  build: { outDir: "dist" }
};
