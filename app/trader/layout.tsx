import type { ReactNode } from "react";
import { TraderShell } from "@/components/trader/Shell";

export default function TraderLayout({ children }: { children: ReactNode }) {
  return <TraderShell>{children}</TraderShell>;
}
