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
  // scale/offset drive the CSS transform; the parallel refs let event handlers
  // read current values without being re-registered on every state change.
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const overlayRef        = useRef<HTMLDivElement | null>(null);
  const scaleRef          = useRef(1);
  const offsetRef         = useRef({ x: 0, y: 0 });
  const isDragging        = useRef(false);
  const hasDragged        = useRef(false); // distinguishes a tap-to-close from a drag release
  const dragStart         = useRef({ x: 0, y: 0 });
  const offsetAtDragStart = useRef({ x: 0, y: 0 });
  // Touch pan: previous single-touch position for delta-based panning.
  const lastSingleTouch   = useRef<{ x: number; y: number } | null>(null);
  // Touch zoom: previous span between two fingers for pinch scaling.
  const lastTouchDistance = useRef<number | null>(null);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Wheel zoom and touch pan/pinch-to-zoom — registered with { passive: false }
  // so preventDefault() suppresses native browser scroll/zoom.
  // All handlers only access refs, so no stale closure concern with empty dep array.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) { return; }

    el.addEventListener('wheel',      handleWheel,      { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove',  handleTouchMove,  { passive: false });
    el.addEventListener('touchend',   handleTouchEnd,   { passive: false });

    return () => {
      el.removeEventListener('wheel',      handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove',  handleTouchMove);
      el.removeEventListener('touchend',   handleTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Close on Escape. Re-registers when onClose identity changes. */
  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /** Writes both the refs (for handler access) and the state (to trigger a re-render). */
  function applyTransform(newScale: number, newOffset: { x: number; y: number }) {
    scaleRef.current  = newScale;
    offsetRef.current = newOffset;
    setScale(newScale);
    setOffset(newOffset);
  }

  /** Zooms toward the cursor position using mouse wheel. */
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const el = overlayRef.current;
    if (!el) { return; }
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
  }

  /** Records touch-start anchor for single-finger pan, or initial span for pinch-zoom. */
  function handleTouchStart(e: TouchEvent) {
    // Let the close button's onClick fire normally — preventDefault() would
    // suppress the synthetic click event the browser generates from the touch.
    if ((e.target as HTMLElement).id === 'hd-modal-close') { return; }
    e.preventDefault();
    if (e.touches.length === 1) {
      // Record anchor for delta-based pan; clear pinch state.
      lastSingleTouch.current   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTouchDistance.current = null;
    } else if (e.touches.length === 2) {
      // Record initial finger span for pinch-zoom ratio; clear pan state.
      lastSingleTouch.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDistance.current = Math.hypot(dx, dy);
    }
  }

  /** Applies single-finger pan or two-finger pinch-zoom on each touch move. */
  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1 && lastSingleTouch.current) {
      // Single-finger pan: apply delta from previous touch position.
      const dx = e.touches[0].clientX - lastSingleTouch.current.x;
      const dy = e.touches[0].clientY - lastSingleTouch.current.y;
      applyTransform(scaleRef.current, {
        x: offsetRef.current.x + dx,
        y: offsetRef.current.y + dy,
      });
      lastSingleTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && lastTouchDistance.current !== null) {
      // Two-finger pinch zoom: scale by ratio of new span to previous span.
      const el = overlayRef.current;
      if (!el) { return; }
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(0.5, Math.min(10, scaleRef.current * (dist / lastTouchDistance.current)));
      // Pivot on finger midpoint using the same zoom-to-cursor formula as handleWheel.
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = el.getBoundingClientRect();
      const mx   = midX - rect.left - rect.width  / 2;
      const my   = midY - rect.top  - rect.height / 2;
      const r = newScale / scaleRef.current;
      applyTransform(newScale, {
        x: offsetRef.current.x + (mx - offsetRef.current.x) * (1 - r),
        y: offsetRef.current.y + (my - offsetRef.current.y) * (1 - r),
      });
      lastTouchDistance.current = dist;
    }
  }

  /** Clears touch tracking on finger lift; re-anchors pan when transitioning from pinch. */
  function handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 0) {
      // All fingers lifted: clear both tracking refs.
      lastSingleTouch.current   = null;
      lastTouchDistance.current = null;
    } else if (e.touches.length === 1) {
      // Transitioned from pinch to single finger: re-anchor pan.
      lastSingleTouch.current   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTouchDistance.current = null;
    }
  }

  /** Closes modal on Escape key. */
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); }
  }

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

  /** Cancels an active drag when the pointer leaves the overlay. */
  function handleMouseLeave() {
    isDragging.current = false;
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
      onMouseLeave={handleMouseLeave}
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
