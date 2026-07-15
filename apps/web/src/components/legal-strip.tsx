import { Info } from "lucide-react";
import { LEGAL_DISCLOSURE } from "@/lib/constants";

export function LegalStrip({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`legal-strip${compact ? " legal-strip-compact" : ""}`}>
      <Info aria-hidden size={17} />
      <p>{LEGAL_DISCLOSURE}</p>
    </aside>
  );
}
