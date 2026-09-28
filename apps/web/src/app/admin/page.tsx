import { AdminMembersPanel } from "@/components/AdminMembersPanel";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();

  return (
    <main className="section">
      <div className="section-head">
        <div>
          <h2>Admin</h2>
          <p className="lede">
            Manage who can sign in and which ESPN (or hub) franchise each member
            owns. Team lists come from the current snapshot store — restore live
            ESPN sync to replace fixture names.
          </p>
        </div>
      </div>
      <AdminMembersPanel />
    </main>
  );
}
