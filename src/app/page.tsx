import { eq } from "drizzle-orm";
import { withUser, requireUser } from "@/db/client";
import { users } from "@/db/schema";
import { AddProductForm } from "@/components/add-product-form.tsx";

export default async function HomePage() {
  let whatsappNumber: string | null = null;

  try {
    const { userId } = await requireUser();
    whatsappNumber = await withUser(userId, async (db) => {
      const rows = await db
        .select({ whatsappNumber: users.whatsappNumber })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.whatsappNumber ?? null;
    });
  } catch {
    // Unauthenticated — middleware will redirect. Render without data.
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page flex flex-col items-center justify-center px-4 py-10">
      <AddProductForm initialWhatsapp={whatsappNumber} />
    </div>
  );
}
