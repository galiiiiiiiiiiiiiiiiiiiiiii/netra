"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./globals.css";

const menu = [
  { name: "Dashboard", href: "/" },
  { name: "Interfaces", href: "/interfaces" },
  { name: "PPP Secrets", href: "/ppp-secrets" },
  { name: "IP Audit", href: "/ip-audit" },
  { name: "Traffic", href: "/traffic" },
  { name: "Alerts", href: "/alerts" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated !== true) {
          setAuthenticated(false);

          if (pathname !== "/") {
            router.replace("/");
          }

          return;
        }

        setAuthenticated(true);
      })
      .catch(() => {
        setAuthenticated(false);

        if (pathname !== "/") {
          router.replace("/");
        }
      });
  }, [pathname, router]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  if (authenticated === null) {
    return (
      <html lang="en">
        <body>
          <main className="auth-loading">Memeriksa sesi...</main>
        </body>
      </html>
    );
  }

  if (pathname === "/" && authenticated !== true) {
    return (
      <html lang="en">
        <body>
          <main className="auth-main">{children}</main>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <button
          type="button"
          className="mobile-menu-button"
          aria-label="Buka menu navigasi"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>

        <aside className={`sidebar${mobileMenuOpen ? " mobile-open" : ""}`}>
          <div className="brand">
            <div className="brand-logo">N</div>

            <div>
              <div className="brand-name">NETRA</div>
              <div className="brand-subtitle">Network Analyzer</div>
            </div>
          </div>

          <nav className="sidebar-nav">
            {menu.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "nav-item active" : "nav-item"}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            className="logout-button"
            onClick={() => {
              setMobileMenuOpen(false);
              handleLogout();
            }}
          >
            Logout
          </button>
        </aside>

        <main className="main-content">{children}</main>
      </body>
    </html>
  );
}
