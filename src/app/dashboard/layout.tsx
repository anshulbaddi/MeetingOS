import { SidebarNav } from "./_components/sidebar-nav";
import { SidebarUser } from "./_components/sidebar-user";
import { Separator } from "@/components/ui/separator";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="px-5 pt-6 pb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Workspace
          </p>
        </div>
        <SidebarNav />
        <Separator className="mt-auto" />
        <SidebarUser />
      </aside>
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
