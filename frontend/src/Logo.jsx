// TaskVerse Earn — app logo (checkmark mark).
// Inline SVG so it renders instantly with no network request and scales cleanly.
// Colors: emerald #059669 on navy #0F172A.
export default function Logo({ size = 80, rounded = true }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="TaskVerse Earn logo"
      style={{ display: 'block' }}
    >
      <rect
        width="512"
        height="512"
        rx={rounded ? 112 : 0}
        ry={rounded ? 112 : 0}
        fill="#0F172A"
      />
      <path
        d="M146 262 L222 338 L370 178"
        fill="none"
        stroke="#059669"
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
