import type { Metadata } from "next";
import { Desk } from "@/components/desk/Desk";

export const metadata: Metadata = {
  title: "Desk · Altron",
  robots: { index: false },
};

export default function DeskPage() {
  return <Desk />;
}
