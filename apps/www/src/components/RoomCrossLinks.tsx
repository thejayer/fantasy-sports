import Link from "next/link";

export const PORTAL_ROOMS = [
  { id: "watch", href: "/watch", label: "Watch" },
  { id: "ai", href: "/ai", label: "AI News" },
  { id: "people", href: "/people", label: "People" },
  { id: "palworld", href: "/palworld", label: "Palworld" },
] as const;

export type PortalRoomId = (typeof PORTAL_ROOMS)[number]["id"];

type Props = {
  current: PortalRoomId;
  heading?: string;
  support?: string;
};

/** Watch ↔ AI ↔ People ↔ Palworld — same set on every room page. */
export function RoomCrossLinks({
  current,
  heading = "Other rooms",
  support = "Same crew. Different rooms.",
}: Props) {
  const others = PORTAL_ROOMS.filter((room) => room.id !== current);
  return (
    <section className="section room-cross" aria-labelledby="room-cross-heading">
      <div className="section-head">
        <div>
          <h2 id="room-cross-heading">{heading}</h2>
          <p>{support}</p>
        </div>
        <div className="section-marker">ROOMS</div>
      </div>
      <ul className="room-cross-links">
        {others.map((room) => (
          <li key={room.id}>
            <Link href={room.href}>{room.label} →</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
