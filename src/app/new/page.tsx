import { eq } from "drizzle-orm"
import { AddProductForm } from "@/components/add-product-form.tsx"
import { requireUser, withUser } from "@/db/client"
import { users } from "@/db/schema"

export default async function NewProductPage() {
  const { userId } = await requireUser()
  const whatsappNumber = await withUser(userId, async (db) => {
    const rows = await db
      .select({ whatsappNumber: users.whatsappNumber })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return rows[0]?.whatsappNumber ?? null
  })

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page flex flex-col items-center justify-center px-4 py-10">
      <AddProductForm initialWhatsapp={whatsappNumber} />
    </div>
  )
}
