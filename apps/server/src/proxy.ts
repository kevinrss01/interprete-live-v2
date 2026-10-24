import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigin } from "@/lib/session";
const CORS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};
// The desktop app runs on tauri://localhost, so every API call is cross-origin.
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { ...CORS };
  if (allowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin!;
  if (request.method === "OPTIONS")
    return new NextResponse(null, { status: 204, headers });
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}
export const config = { matcher: "/api/:path*" };
