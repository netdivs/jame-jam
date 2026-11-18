"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Boxes,
  BookOpen,
  Building2,
  ClipboardList,
  FileClock,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Percent,
  Receipt,
  Settings,
  ShieldCheck,
  Sun,
  Truck,
  Users,
  Warehouse,
  X,
  Grid3x3,
  ArrowLeftRight,
  CalendarClock,
  ShoppingCart,
  PackageCheck,
  FileText,
  Wallet,
  Coins,
  ClipboardCheck,
  ScrollText,
  Landmark,
  ChartColumn,
  HandCoins,
  Banknote,
  Undo2,
  PiggyBank,
  ListChecks,
  NotebookTabs,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };
export type NavGroup = { label: string; items: NavItem[] };

const ICONS = {
  dashboard: LayoutDashboard,
  stock: Boxes,
  lots: Layers,
  slabs: Grid3x3,
  movements: ArrowLeftRight,
  customers: Users,
  suppliers: Truck,
  products: Package,
  warehouses: Warehouse,
  landed: Receipt,
  coa: BookOpen,
  journals: ClipboardList,
  periods: CalendarClock,
  settings: Settings,
  users: Users,
  roles: ShieldCheck,
  tax: Percent,
  audit: FileClock,
  company: Building2,
  purchaseOrders: ShoppingCart,
  grn: PackageCheck,
  supplierInvoices: FileText,
  supplierPayments: Wallet,
  landedCosts: Coins,
  salesOrders: ClipboardCheck,
  proformas: ScrollText,
  banks: Landmark,
  reports: ChartColumn,
  receipts: HandCoins,
  cheques: Banknote,
  refunds: Undo2,
  pettyCash: PiggyBank,
  bankRec: ListChecks,
  ledgers: NotebookTabs,
};

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("jj-theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
    >
      {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

export function AppShell({
  nav,
  user,
  company,
  logoutAction,
  children,
}: {
  nav: NavGroup[];
  user: { name: string; roleName: string };
  company: string;
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-on-primary">JJ</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{company}</div>
          <div className="text-xs text-muted">ERP</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {nav.map((g) => (
          <div key={g.label} className="mb-4">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</div>
            <ul>
              {g.items.map((it) => {
                const Icon = ICONS[it.icon];
                const active = isActive(it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-150 ${
                        active ? "bg-info-bg font-medium text-primary" : "text-fg hover:bg-surface-2"
                      }`}
                    >
                      <Icon size={16} aria-hidden className={active ? "" : "text-muted"} />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr] print:!block">
      <aside className="hidden border-r border-border bg-surface lg:sticky lg:top-0 lg:block lg:h-screen print:!hidden">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-2 top-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2"
            >
              <X size={18} aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 lg:hidden"
          >
            <Menu size={20} aria-hidden />
          </button>
          <div className="flex-1" />
          <ThemeToggle />
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight text-fg">{user.name}</div>
            <div className="text-xs leading-tight text-muted">{user.roleName}</div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
            >
              <LogOut size={18} aria-hidden />
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
