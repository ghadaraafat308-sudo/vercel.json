// api/index.js
// Vercel serverless entry point. vercel.json routes every request that
// isn't a static file to this one function, which just hands it to the
// same Express app used locally (see app.js).
import { app } from "../app.js";

export default function handler(req, res) {
  return app(req, res);
}
