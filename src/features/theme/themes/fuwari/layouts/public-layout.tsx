import { useState } from "react";
import type { PublicLayoutProps } from "@/features/theme/contract/layouts";
import { BackToTop } from "../components/control/back-to-top";
import { Footer } from "./footer";
import { MobileMenu } from "./mobile-menu";
import { Navbar } from "./navbar";

export function PublicLayout({
  children,
  navOptions,
  user,
  isSessionLoading,
  logout,
}: PublicLayoutProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="relative min-h-screen bg-(--fuwari-page-bg) transition-colors">
      <MobileMenu
        navOptions={navOptions}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        user={user}
        logout={logout}
      />

      <header className="sticky top-0 z-50">
        <Navbar
          navOptions={navOptions}
          onMenuClick={() => setIsMenuOpen(true)}
          user={user}
          isLoading={isSessionLoading}
        />
      </header>

      <div className="mx-auto w-full max-w-(--fuwari-page-width) px-6 pb-20">
        <main className="min-w-0">{children}</main>
        <Footer navOptions={navOptions} />
      </div>

      <BackToTop />
    </div>
  );
}
