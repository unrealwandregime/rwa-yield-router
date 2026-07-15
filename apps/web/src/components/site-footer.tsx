import Link from "next/link";
import { LEGAL_DISCLOSURE } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <strong>RWA Yield Router</strong>
          <p>{LEGAL_DISCLOSURE}</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/methodology">Methodology</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/legal/disclaimer">Disclaimer</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
