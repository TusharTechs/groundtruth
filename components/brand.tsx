/**
 * The GroundTruth mark: an outbound call arc, with the verified answer
 * rising through it. Source of truth for the logo geometry — docs/brand/
 * holds the exported wordmarks built from these same paths.
 */
export function GroundTruthMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <mask id="gt-mark-notch">
        <rect width="64" height="64" fill="#fff" />
        <path
          d="M19 40 L28 49 L51 17"
          stroke="#000"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <path
        d="M11 33 A22 22 0 0 1 46 19"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="5.5"
        strokeLinecap="round"
        mask="url(#gt-mark-notch)"
      />
      <path
        d="M19 40 L28 49 L51 17"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
