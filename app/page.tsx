import { FeedProvider } from "@/components/landing/FeedProvider";
import { Hero } from "@/components/landing/Hero";
import { MarketStrip } from "@/components/landing/MarketStrip";
import { Desk } from "@/components/landing/Desk";
import { Membership } from "@/components/landing/Membership";
import { Method } from "@/components/landing/Method";
import { Ledger } from "@/components/landing/Ledger";
import { Access } from "@/components/landing/Access";
import { Footer } from "@/components/landing/Footer";
import s from "@/components/landing/landing.module.css";

export default function Home() {
  return (
    <main className={s.page}>
      <FeedProvider>
        <Hero />
        <MarketStrip />
        <Desk />
      </FeedProvider>
      <Membership />
      <Method />
      <Ledger />
      <Access />
      <Footer />
    </main>
  );
}
