const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");

const app = express();
const backend = process.env.API_URL;

if (!backend) throw new Error("Missing API_URL");

app.use(
  ["/api", "/uploads"],
  createProxyMiddleware({
    target: backend,
    changeOrigin: true,
  })
);

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(process.env.PORT || 3000, "0.0.0.0");