import { ExternalLink } from "lucide-react";

export function SourceLink({ name, url }: { name: string; url: string }) {
  return (
    <a className="source-link" href={url} rel="noopener noreferrer" target="_blank">
      {name}
      <ExternalLink aria-hidden size={13} />
    </a>
  );
}
