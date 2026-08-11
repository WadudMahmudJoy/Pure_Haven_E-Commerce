"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type MobileUIContextType = {
  isMenuOpen: boolean;
  isSearchOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
  closeAll: () => void;
};

const MobileUIContext = createContext<MobileUIContextType | undefined>(
  undefined
);

export function MobileUIProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const openMenu = useCallback(() => {
    setIsSearchOpen(false);
    setIsMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const toggleMenu = useCallback(() => {
    setIsSearchOpen(false);
    setIsMenuOpen((prev) => !prev);
  }, []);

  const openSearch = useCallback(() => {
    setIsMenuOpen(false);
    setIsSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const toggleSearch = useCallback(() => {
    setIsMenuOpen(false);
    setIsSearchOpen((prev) => !prev);
  }, []);

  const closeAll = useCallback(() => {
    setIsMenuOpen(false);
    setIsSearchOpen(false);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  const value = useMemo(
    () => ({
      isMenuOpen,
      isSearchOpen,
      openMenu,
      closeMenu,
      toggleMenu,
      openSearch,
      closeSearch,
      toggleSearch,
      closeAll,
    }),
    [
      isMenuOpen,
      isSearchOpen,
      openMenu,
      closeMenu,
      toggleMenu,
      openSearch,
      closeSearch,
      toggleSearch,
      closeAll,
    ]
  );

  return (
    <MobileUIContext.Provider value={value}>
      {children}
    </MobileUIContext.Provider>
  );
}

export function useMobileUI() {
  const context = useContext(MobileUIContext);

  if (!context) {
    throw new Error("useMobileUI must be used inside MobileUIProvider");
  }

  return context;
}