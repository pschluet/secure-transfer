import { useEffect, useRef, useState } from "react";

function RefreshIcon({ iconRef }: { iconRef: React.RefObject<SVGSVGElement> }) {
  return (
    <svg ref={iconRef} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline
        points="23 4 23 10 17 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="1 20 1 14 7 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Current rotation of an animated element, normalized to [0, 360). */
function currentRotationDeg(el: SVGSVGElement): number {
  const transform = getComputedStyle(el).transform;
  if (transform === "none") return 0;
  const matrix = new DOMMatrixReadOnly(transform);
  const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return ((angle % 360) + 360) % 360;
}

export function RefreshButton({
  onRefresh,
  label = "Refresh",
}: {
  onRefresh: () => Promise<void>;
  label?: string;
}) {
  const [spinning, setSpinning] = useState(false);
  const iconRef = useRef<SVGSVGElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cancels the infinite spin at its exact current angle instead of letting
  // it snap back to 0deg, then eases forward to the next full turn (which
  // looks identical to the resting position) so the stop reads as smooth.
  function stopSpinningSmoothly() {
    cleanupRef.current?.();
    const icon = iconRef.current;
    if (!icon) return;

    const angle = currentRotationDeg(icon);
    icon.style.transition = "none";
    icon.style.animation = "none";
    icon.style.transform = `rotate(${angle}deg)`;
    icon.getBoundingClientRect(); // force a reflow before re-enabling the transition

    icon.style.transition = "transform 0.4s ease";
    icon.style.transform = "rotate(360deg)";

    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "transform") return;
      cleanup();
    };
    const cleanup = () => {
      icon.style.transition = "";
      icon.style.animation = "";
      icon.style.transform = "";
      icon.removeEventListener("transitionend", onTransitionEnd);
      cleanupRef.current = null;
    };
    icon.addEventListener("transitionend", onTransitionEnd);
    cleanupRef.current = cleanup;
  }

  useEffect(() => () => cleanupRef.current?.(), []);

  async function handleClick() {
    if (spinning) return;
    setSpinning(true);
    try {
      await onRefresh();
    } finally {
      stopSpinningSmoothly();
      setSpinning(false);
    }
  }

  return (
    <button
      type="button"
      className={`refresh-button${spinning ? " spinning" : ""}`}
      onClick={() => void handleClick()}
      aria-label={label}
      aria-busy={spinning}
      title={label}
    >
      <RefreshIcon iconRef={iconRef} />
    </button>
  );
}
