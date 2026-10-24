import { Hono } from "hono";
import api from "./dist/app.mjs";

// Keep Node's production entrypoint self-contained; local TypeScript imports stay unchanged.
export default new Hono().route("/", api);
