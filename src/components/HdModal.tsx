import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Props for the HD map preview modal. */
interface HdModalProps {
  src: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full-screen modal that displays a map image with mouse-wheel zoom and
 * click-drag pan. Closes on Escape, the ✕ button, or a bare click on the
 * backdrop (a drag release does not count as a close click).
 */
export function HdModal({ src, onClose }: HdModalProps) {
  // scale/offset drive the CSS transform; the parallel refs let the wheel
  // handler read current values without being re-registered on every change.
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const overlayRef        = useRef<HTMLDivElement | null>(null);
  const scaleRef          = useRef(1);
  const offsetRef         = useRef({ x: 0, y: 0 });
  const isDragging        = useRef(false);
  const hasDragged        = useRef(false); // distinguishes a tap-to-close from a drag release
  const dragStart         = useRef({ x: 0, y: 0 });
  const offsetAtDragStart = useRef({ x: 0, y: 0 });

  /** Writes both the refs (for handler access) and the state (to trigger a re-render). */
  function applyTransform(newScale: number, newOffset: { x: number; y: number }) {
    scaleRef.current  = newScale;
    offsetRef.current = newOffset;
    setScale(newScale);
    setOffset(newOffset);
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Wheel listener registered with { passive: false } so preventDefault() works.
  // Empty dep array — handler reads live values from refs, never goes stale.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) { return; }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor   = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.max(0.5, Math.min(10, scaleRef.current * factor));
      const rect     = el.getBoundingClientRect();
      // Mouse position relative to the overlay centre (= image centre at offset 0).
      const mx = e.clientX - rect.left - rect.width  / 2;
      const my = e.clientY - rect.top  - rect.height / 2;
      // Zoom-to-cursor: adjust offset so the world point under the cursor stays fixed.
      // Derivation: newOffset = cursor - imagePoint * newScale, imagePoint = (cursor - offset) / oldScale.
      const r = newScale / scaleRef.current;
      applyTransform(newScale, {
        x: offsetRef.current.x + (mx - offsetRef.current.x) * (1 - r),
        y: offsetRef.current.y + (my - offsetRef.current.y) * (1 - r),
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  /** Close on Escape. */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); } };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /** Begins a pan gesture. Skips if the close button was the target. */
  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).id === 'hd-modal-close') { return; }
    isDragging.current        = true;
    hasDragged.current        = false;
    dragStart.current         = { x: e.clientX, y: e.clientY };
    offsetAtDragStart.current = { ...offsetRef.current };
    e.preventDefault();
  }

  /** Continues an active pan, marking hasDragged once motion exceeds 3 px. */
  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging.current) { return; }
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { hasDragged.current = true; }
    applyTransform(scaleRef.current, {
      x: offsetAtDragStart.current.x + dx,
      y: offsetAtDragStart.current.y + dy,
    });
  }

  /** Ends a pan gesture; closes the modal if released on the backdrop without dragging. */
  function handleMouseUp(e: React.MouseEvent) {
    const wasDragging = isDragging.current;
    isDragging.current = false;
    if (!wasDragging) { return; }
    if (!hasDragged.current && (e.target as HTMLElement).id === 'hd-modal-overlay') {
      onClose();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={overlayRef}
      id="hd-modal-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { isDragging.current = false; }}
    >
      <button id="hd-modal-close" onClick={onClose}>✕</button>
      <img
        id="hd-modal-img"
        src={src}
        alt="HD map preview"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        draggable={false}
      />
    </div>
  );
}
