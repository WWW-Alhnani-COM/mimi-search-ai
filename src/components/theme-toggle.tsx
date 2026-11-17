"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="inline-block h-11 w-11 rounded-xl border border-border" aria-hidden="true"/>;
  const dark = resolvedTheme === "dark";
  return <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"} className="rounded-xl border border-border bg-card p-3 text-slate-500 hover:text-primary">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}