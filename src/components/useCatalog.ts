"use client";
import { useEffect, useState } from "react";
import type { Catalog } from "@/lib/offline/types";
import { getCatalog, refreshCatalog } from "@/lib/offline/sync";

export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null);
  useEffect(() => {
    let alive = true;
    void getCatalog().then((c) => { if (alive && c) setCat(c); });
    void refreshCatalog().then((c) => { if (alive && c) setCat(c); });
    const on = () => void getCatalog().then((c) => alive && c && setCat(c));
    window.addEventListener("shop-catalog", on);
    return () => { alive = false; window.removeEventListener("shop-catalog", on); };
  }, []);
  return cat;
}
