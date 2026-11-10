import { create } from "zustand";

/**
 * What the Community page is looking at: the live trade (viewing = null) or one picked
 * from the record. `focus` asks the chart to bring that trade's stretch of time into view.
 */
type View = { viewing: string | null; focus: { from: number; to: number } | null };

export const useView = create<View>(() => ({ viewing: null, focus: null }));

export function viewTrade(id: string | null, span?: { from: number; to: number }) {
  useView.setState({ viewing: id, focus: id && span ? { ...span } : null });
}
