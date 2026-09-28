/**
 * Marks the signed-in member's own franchise (roadmap 7.1).
 *
 * Colour alone is not an accessible signal, so the badge carries a visible
 * "You" label rather than relying on the row tint that accompanies it.
 */
export function ViewerBadge({ label = "You" }: { label?: string }) {
  return (
    <span className="viewer-badge" title="Your franchise">
      {label}
    </span>
  );
}
