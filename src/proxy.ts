import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

/**
 * Public routes — readable without auth.
 * - `/` is the marketing landing page.
 * - `/privacy` is the public privacy policy.
 * - `/api/orders` is the public COD form endpoint posted from Shopify-hosted
 *   landings (CORS-whitelisted to *.myshopify.com).
 * - `/api/creative-preview` is a UUID-gated video proxy; must be public so
 *   Vercel's CDN can cache responses (Clerk's `Set-Cookie` on every request
 *   defeats `Cache-Control: public` caching otherwise).
 * - Sign-in / sign-up routes obviously must be public.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/privacy(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/orders(.*)",
  "/api/creative-preview(.*)",
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run on API routes.
    "/(api|trpc)(.*)",
  ],
}
