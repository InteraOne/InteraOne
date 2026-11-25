import type { SVGProps } from "react";
import { MessagesSquare } from "lucide-react";

type ChannelIconProps = SVGProps<SVGSVGElement> & {
  channel: string;
};

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

export function WhatsAppIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347Z"
      />
      <path
        fill="#25D366"
        d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.858L.057 23.428a.75.75 0 0 0 .916.916l5.57-1.476A11.95 11.95 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0Zm0 22c-1.896 0-3.67-.523-5.184-1.433l-.37-.22-3.307.876.876-3.308-.22-.37A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10Z"
      />
    </svg>
  );
}

export function TelegramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <path
        fill="#229ED9"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0h-.056Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z"
      />
    </svg>
  );
}

export function EmailIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <path fill="#4285F4" d="M1.636 5.457 5.455 8.32v12.683H1.636A1.636 1.636 0 0 1 0 19.366V6.275c0-.904.732-1.636 1.636-1.636Z" />
      <path fill="#34A853" d="M18.545 8.32 22.364 5.457A1.636 1.636 0 0 1 24 6.275v13.091c0 .904-.732 1.636-1.636 1.636h-3.819V8.32Z" />
      <path fill="#EA4335" d="M1.636 3.002c.37 0 .73.126 1.018.342L12 10.35l9.346-7.006A1.636 1.636 0 0 1 24 4.639v1.636L12 15.275 0 6.275V4.639c0-.904.732-1.637 1.636-1.637Z" />
      <path fill="#FBBC04" d="m5.455 8.32 6.545 4.91 6.545-4.91v3.273L12 16.503l-6.545-4.91V8.32Z" />
    </svg>
  );
}

export function WebIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6366F1"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 1 0 20A14.5 14.5 0 0 1 12 2M2 12h20" />
    </svg>
  );
}

export function AllChannelsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" role="img" aria-hidden="true" {...props}>
      <rect x="2" y="3" width="7" height="7" rx="1" stroke="#8B5CF6" />
      <rect x="15" y="3" width="7" height="7" rx="1" stroke="#06B6D4" />
      <rect x="2" y="14" width="7" height="7" rx="1" stroke="#10B981" />
      <rect x="15" y="14" width="7" height="7" rx="1" stroke="#F59E0B" />
    </svg>
  );
}

export function ChannelIcon({ channel, ...props }: ChannelIconProps) {
  const normalized = channel.toLowerCase().replace(/_channel$/, "");

  if (normalized === "threads") return <MessagesSquare {...props} />;
  if (normalized.includes("email")) return <EmailIcon {...props} />;
  if (normalized.includes("whatsapp")) return <WhatsAppIcon {...props} />;
  if (normalized.includes("telegram")) return <TelegramIcon {...props} />;
  return <WebIcon {...props} />;
}
