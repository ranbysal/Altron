import type { Metadata } from "next";
import { LoginView } from "@/components/login/LoginView";

export const metadata: Metadata = {
  title: "Sign in — Altron",
};

export default function LoginPage() {
  return <LoginView />;
}
