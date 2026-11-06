import { AppSidebar } from '@/components/shell/app-sidebar';
import { SystemSkin } from '@/components/shell/system-skin';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

// Every page reads the local database, so render on each request.
export const dynamic = 'force-dynamic';

export default function ShellLayout({ children }: LayoutProps<'/'>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-muted-foreground text-sm">Week of 2 November 2026</span>
        </header>
        <SystemSkin>{children}</SystemSkin>
      </SidebarInset>
    </SidebarProvider>
  );
}
