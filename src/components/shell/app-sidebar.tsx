'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_SECTIONS } from '@/apps/registry';
import { NewBadge } from '@/components/handoff/built';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground">
                M
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">MentOS</span>
                <span className="truncate text-muted-foreground text-xs">RevOps case</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {APP_SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarMenu>
              {section.apps.map((app) => (
                <SidebarMenuItem key={app.id}>
                  <SidebarMenuButton
                    isActive={isActive(pathname, app.href)}
                    tooltip={app.label}
                    render={<Link href={app.href} />}
                  >
                    <app.icon />
                    <span>{app.label}</span>
                    {app.badge ? (
                      <NewBadge
                        label={app.badge}
                        className="ml-auto group-data-[collapsible=icon]:hidden"
                      />
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
          Every system here is a mock on your machine.
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
