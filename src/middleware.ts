import { NextRequest, NextResponse } from "next/server";
import { buildCSP, CSP_NONCE_HEADER } from "@/lib/csp";

/**
 * Generates a fresh CSP nonce per request and forwards it two ways:
 *  - as a request header, so Server Components can read it via next/headers
 *    and stamp it onto any inline <script>/<style> tags they render
 *  - as the Content-Security-Policy response header itself
 *
 * See https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isEmbed = request.nextUrl.pathname.startsWith("/embed/");
  const csp = buildCSP(nonce, { allowFraming: isEmbed });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Skip static assets and image optimization files — they carry no
     * inline scripts and re-running CSP generation for every asset request
     * is pure overhead.
     *
     * Also skip the interactive API documentation route (/api-docs) and the
     * static OpenAPI spec (/openapi.json, /openapi.yaml). Swagger UI ships its
     * own bundled scripts/styles and the spec is a static JSON/YAML document,
     * so neither needs a per-request CSP nonce. Excluding them lets the
     * Swagger UI assets load correctly while CSP protections remain in place
     * for the rest of the app.
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|api-docs|openapi\\.(?:json|yaml|yml)).*)",
  ],
};