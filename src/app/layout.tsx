import { ClerkProvider, Show } from "@clerk/nextjs"
import type { Metadata } from "next"
import { JobsDock } from "@/components/jobs-dock.tsx"
import { JobsDockProvider } from "@/components/jobs-dock-provider.tsx"
import { Nav } from "@/components/nav.tsx"
import { QueryProvider } from "@/components/providers/query-provider.tsx"
import { Toaster } from "@/components/ui/sonner.tsx"
import "./globals.css"

export const metadata: Metadata = {
  title: "Replik AI",
  description: "Automated dropshipping product testing — LATAM, Perú-first.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html lang="es-PE" className="h-full antialiased">
        <body className="min-h-full flex flex-col">
          <QueryProvider>
            <Show when="signed-in" fallback={children}>
              <JobsDockProvider>
                <Nav />
                <main className="flex-1">{children}</main>
                <JobsDock />
              </JobsDockProvider>
            </Show>
          </QueryProvider>
          <Toaster richColors position="top-right" />
        </body>
      </html>
    </ClerkProvider>
  )
}
