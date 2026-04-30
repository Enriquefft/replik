import { getDashboard } from "@/server/actions/dashboard.ts";
import { DashboardClient } from "./dashboard-client.tsx";

export default async function DashboardPage() {
  const result = await getDashboard();

  const initialData = result.ok ? result.data : { products: [] };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-caption font-semibold uppercase tracking-widest text-mode-live-badge-fg mb-1">
            Dashboard
          </p>
          <h2 className="text-title">Tus productos</h2>
          <p className="text-body text-fg-2 mt-1">
            Métricas de tus campañas activas y pedidos.
          </p>
        </div>

        <DashboardClient initialData={initialData} />
      </div>
    </div>
  );
}
