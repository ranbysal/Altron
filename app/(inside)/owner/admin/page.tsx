import type { Metadata } from "next";
import { Admin } from "@/components/owner/Admin";

export const metadata: Metadata = {
  title: "Admin · Altron",
  robots: { index: false },
};

export default function AdminPage() {
  return <Admin />;
}
