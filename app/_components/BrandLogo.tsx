import Image from "next/image";
import { BRAND_ASSETS } from "@/lib/brand";

/** Decorative mark; the surrounding home link supplies the accessible brand name. */
export function BrandLogo({
  className = "h-10 w-10",
  sizes = "40px",
  preload = false,
}: {
  className?: string;
  sizes?: string;
  preload?: boolean;
}) {
  return (
    <span className={`relative inline-flex aspect-square shrink-0 ${className}`} aria-hidden="true">
      <Image
        src={BRAND_ASSETS.logo}
        alt=""
        fill
        sizes={sizes}
        preload={preload}
        loading={preload ? undefined : "eager"}
        draggable={false}
        className="select-none object-contain"
      />
    </span>
  );
}
