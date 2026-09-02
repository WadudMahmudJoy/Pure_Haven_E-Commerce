"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import SafeImage from "@/components/ui/SafeImage";
import { normalizeImageSrc } from "@/lib/imagePaths";
import {
  createInitialCarouselState,
  markSlideLoaded,
  requestSlide,
  completeSlidePreload,
  failSlide,
  getAvailableSlideIndices,
  type CarouselState,
} from "./carouselNavigation";

export type ProductCardCarouselProps = {
  productId: number;
  productName: string;
  category: string;
  images: string[];
  priority?: boolean;
};

export default function ProductCardCarousel({
  productId,
  productName,
  category,
  images,
  priority = false,
}: ProductCardCarouselProps) {
  // Fail-closed on missing or empty image inputs (never invent a fake [""] gallery)
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("ProductCardCarousel requires at least one image.");
  }

  // Defensively bound gallery to at most 4 items (Task-4 public cap)
  const gallery = useMemo(() => {
    return images.slice(0, 4);
  }, [images]);

  const [state, setState] = useState<CarouselState>(() =>
    createInitialCarouselState(gallery.length)
  );

  // Reset carousel state if productId or gallery identity changes (collision-safe key)
  const galleryKey = JSON.stringify([productId, gallery]);
  const [prevGalleryKey, setPrevGalleryKey] = useState(galleryKey);
  if (prevGalleryKey !== galleryKey) {
    setPrevGalleryKey(galleryKey);
    setState(createInitialCarouselState(gallery.length));
  }

  // Two-stage structural preload: only the currently requested pendingIndex is preloaded
  useEffect(() => {
    if (state.pendingIndex === null) return;
    if (typeof window === "undefined") return;

    const targetIndex = state.pendingIndex;
    const targetRawSrc = gallery[targetIndex];
    if (!targetRawSrc) return;

    const normalizedTargetSrc = normalizeImageSrc(targetRawSrc, { category });

    let isAborted = false;
    const preloader = new window.Image();

    preloader.onload = () => {
      if (isAborted) return;
      setState((prev) => completeSlidePreload(prev, targetIndex));
    };

    preloader.onerror = () => {
      if (isAborted) return;
      setState((prev) => failSlide(prev, targetIndex).state);
    };

    preloader.src = normalizedTargetSrc;

    return () => {
      isAborted = true;
      preloader.onload = null;
      preloader.onerror = null;
    };
  }, [state.pendingIndex, gallery, category]);

  const availableIndices = useMemo(
    () => getAvailableSlideIndices(state),
    [state]
  );

  // Separate arrow controls and indicator visibility contracts
  const showArrowControls = availableIndices.length > 1;
  const showIndicators =
    state.totalImages > 1 && availableIndices.length > 0;

  const displayedIndex = state.displayedIndex;
  const currentRawSrc = gallery[displayedIndex] || gallery[0] || "";
  const currentSrc = normalizeImageSrc(currentRawSrc, { category });

  function handlePrimaryLoad() {
    setState((prev) => markSlideLoaded(prev, 0));
  }

  function handlePrimaryError() {
    setState((prev) => failSlide(prev, 0).state);
  }

  function handlePrev(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (availableIndices.length <= 1) return;

    const currentPos = availableIndices.indexOf(state.displayedIndex);
    const prevPos =
      currentPos <= 0 ? availableIndices.length - 1 : currentPos - 1;
    const targetIndex = availableIndices[prevPos];
    setState((prev) => requestSlide(prev, targetIndex));
  }

  function handleNext(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (availableIndices.length <= 1) return;

    const currentPos = availableIndices.indexOf(state.displayedIndex);
    const nextPos = (currentPos + 1) % availableIndices.length;
    const targetIndex = availableIndices[nextPos];
    setState((prev) => requestSlide(prev, targetIndex));
  }

  function handleIndicatorClick(
    e: React.MouseEvent<HTMLButtonElement>,
    targetIndex: number
  ) {
    e.preventDefault();
    e.stopPropagation();
    setState((prev) => requestSlide(prev, targetIndex));
  }

  // Keyboard navigation: ArrowLeft / ArrowRight
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (availableIndices.length <= 1) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const currentPos = availableIndices.indexOf(state.displayedIndex);
      const prevPos =
        currentPos <= 0 ? availableIndices.length - 1 : currentPos - 1;
      const targetIndex = availableIndices[prevPos];
      setState((prev) => requestSlide(prev, targetIndex));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const currentPos = availableIndices.indexOf(state.displayedIndex);
      const nextPos = (currentPos + 1) % availableIndices.length;
      const targetIndex = availableIndices[nextPos];
      setState((prev) => requestSlide(prev, targetIndex));
    }
  }

  // Touch swipe support (40px threshold)
  const touchStartXRef = useRef<number | null>(null);

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartXRef.current === null) return;
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    const endX = e.changedTouches[0]?.clientX ?? null;
    if (endX === null) return;

    const deltaX = endX - startX;
    const threshold = 40;

    if (Math.abs(deltaX) < threshold) return;
    if (availableIndices.length <= 1) return;

    const currentPos = availableIndices.indexOf(state.displayedIndex);
    if (deltaX < -threshold) {
      // Swipe left -> next image
      const nextPos = (currentPos + 1) % availableIndices.length;
      const target = availableIndices[nextPos];
      setState((prev) => requestSlide(prev, target));
    } else if (deltaX > threshold) {
      // Swipe right -> previous image
      const prevPos =
        currentPos <= 0 ? availableIndices.length - 1 : currentPos - 1;
      const target = availableIndices[prevPos];
      setState((prev) => requestSlide(prev, target));
    }
  }

  return (
    <div
      className="relative overflow-hidden rounded-[14px] bg-[#f8f3ef] sm:rounded-[18px] lg:rounded-[22px]"
      role="region"
      aria-roledescription="carousel"
      aria-label={productName + " image gallery"}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Active product image is clickable to /product/{id} */}
      <Link href={"/product/" + productId} className="block aspect-square w-full">
        <SafeImage
          src={currentSrc}
          alt={productName}
          category={category}
          priority={priority}
          onLoad={displayedIndex === 0 ? handlePrimaryLoad : undefined}
          onErrorCapture={displayedIndex === 0 ? handlePrimaryError : undefined}
          className="aspect-square w-full object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
        />
      </Link>

      {/* Carousel controls are SIBLINGS of the product Link to avoid invalid <a><button></a> nesting */}
      {showArrowControls ? (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={handlePrev}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#2e221d] shadow-sm backdrop-blur-xs transition hover:bg-white sm:h-8 sm:w-8"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            aria-label="Next image"
            onClick={handleNext}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[#2e221d] shadow-sm backdrop-blur-xs transition hover:bg-white sm:h-8 sm:w-8"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </>
      ) : null}

      {/* Indicator dots preserve original gallery position and remain available even if only one real slide survives */}
      {showIndicators ? (
        <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-10 flex items-center justify-center gap-1.5">
          {availableIndices.map((slideIdx) => {
            const isDisplayed = slideIdx === state.displayedIndex;
            return (
              <button
                key={slideIdx}
                type="button"
                aria-label={"Show image " + (slideIdx + 1) + " of " + state.totalImages}
                aria-current={isDisplayed ? "true" : undefined}
                onClick={(e) => handleIndicatorClick(e, slideIdx)}
                className={"pointer-events-auto h-1.5 rounded-full transition-all duration-200 " + (
                  isDisplayed
                    ? "w-4 bg-[#2e221d]"
                    : "w-1.5 bg-black/30 hover:bg-black/50"
                )}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
