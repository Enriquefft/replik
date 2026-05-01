import { auth } from "@clerk/nextjs/server"
import { MarketingHome } from "@/components/marketing-home.tsx"

export default async function HomePage() {
  const { userId } = await auth()
  return <MarketingHome signedIn={Boolean(userId)} />
}
