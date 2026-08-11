"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function RouteChromeGuard() {
  const pathname = usePathname();

  useEffect(() => {
    const isAdminOrLogin =
      pathname.startsWith("/admin") ||
      pathname === "/login" ||
      pathname === "/admin/login";

    document.body.classList.toggle("ph-hide-customer-chrome", isAdminOrLogin);

    return () => {
      document.body.classList.remove("ph-hide-customer-chrome");
    };
  }, [pathname]);

  return null;
}
