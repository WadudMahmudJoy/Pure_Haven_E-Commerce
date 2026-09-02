export type CarouselState = {
  displayedIndex: number;
  pendingIndex: number | null;
  loadedIndices: Set<number>;
  failedIndices: Set<number>;
  totalImages: number;
};

export type CarouselFailureAction =
  | "secondary-skipped"
  | "primary-fallback"
  | "all-real-images-failed";

/**
 * Creates initial carousel state.
 * Primary index 0 begins visible in the DOM, but is marked loaded only
 * when its real onLoad event fires.
 */
export function createInitialCarouselState(totalImages: number): CarouselState {
  if (!Number.isInteger(totalImages) || totalImages <= 0) {
    throw new Error("totalImages must be a positive integer.");
  }

  return {
    displayedIndex: 0,
    pendingIndex: null,
    loadedIndices: new Set<number>(),
    failedIndices: new Set<number>(),
    totalImages,
  };
}

/**
 * Records that a slide's real image has finished loading.
 * Always pure and immutable.
 */
export function markSlideLoaded(
  state: CarouselState,
  index: number
): CarouselState {
  const nextLoaded = new Set(state.loadedIndices);
  nextLoaded.add(index);
  return {
    ...state,
    loadedIndices: nextLoaded,
    failedIndices: new Set(state.failedIndices),
  };
}

/**
 * Requests navigation to targetIndex.
 * - If target is out of range, failed, or already active without pending, returns state unchanged.
 * - If target is already loaded, switches displayedIndex immediately.
 * - If target is not loaded, preserves currently displayed slide and records target in pendingIndex.
 */
export function requestSlide(
  state: CarouselState,
  targetIndex: number
): CarouselState {
  if (
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= state.totalImages ||
    state.failedIndices.has(targetIndex)
  ) {
    return {
      ...state,
      loadedIndices: new Set(state.loadedIndices),
      failedIndices: new Set(state.failedIndices),
    };
  }

  if (targetIndex === state.displayedIndex && state.pendingIndex === null) {
    return {
      ...state,
      loadedIndices: new Set(state.loadedIndices),
      failedIndices: new Set(state.failedIndices),
    };
  }

  if (state.loadedIndices.has(targetIndex)) {
    return {
      ...state,
      displayedIndex: targetIndex,
      pendingIndex: null,
      loadedIndices: new Set(state.loadedIndices),
      failedIndices: new Set(state.failedIndices),
    };
  }

  return {
    ...state,
    displayedIndex: state.displayedIndex,
    pendingIndex: targetIndex,
    loadedIndices: new Set(state.loadedIndices),
    failedIndices: new Set(state.failedIndices),
  };
}

/**
 * Completes preload of a secondary slide.
 * - Always records loadedIndex in loadedIndices.
 * - Only switches displayedIndex when loadedIndex is still the current pendingIndex.
 * - If an older preload completes while a newer target is pending, displayedIndex is NOT switched.
 */
export function completeSlidePreload(
  state: CarouselState,
  loadedIndex: number
): CarouselState {
  const nextLoaded = new Set(state.loadedIndices);
  nextLoaded.add(loadedIndex);

  if (state.pendingIndex === loadedIndex) {
    return {
      ...state,
      displayedIndex: loadedIndex,
      pendingIndex: null,
      loadedIndices: nextLoaded,
      failedIndices: new Set(state.failedIndices),
    };
  }

  return {
    ...state,
    loadedIndices: nextLoaded,
    failedIndices: new Set(state.failedIndices),
  };
}

/**
 * Handles slide load failure.
 * - Adds failedIndex to failedIndices.
 * - If failedIndex was pending, clears pendingIndex.
 * - Determines appropriate failure action:
 *   - "all-real-images-failed" if every real slide has failed.
 *   - "primary-fallback" if primary slide 0 failed (allowing secondaries to remain).
 *   - "secondary-skipped" if a secondary slide failed.
 */
export function failSlide(
  state: CarouselState,
  failedIndex: number
): {
  state: CarouselState;
  action: CarouselFailureAction;
} {
  const nextFailed = new Set(state.failedIndices);
  nextFailed.add(failedIndex);

  const nextPending =
    state.pendingIndex === failedIndex ? null : state.pendingIndex;

  const nextState: CarouselState = {
    ...state,
    pendingIndex: nextPending,
    loadedIndices: new Set(state.loadedIndices),
    failedIndices: nextFailed,
  };

  if (nextFailed.size >= state.totalImages) {
    return {
      state: nextState,
      action: "all-real-images-failed",
    };
  }

  if (failedIndex === 0) {
    return {
      state: nextState,
      action: "primary-fallback",
    };
  }

  return {
    state: nextState,
    action: "secondary-skipped",
  };
}

/**
 * Returns all slide indices 0..totalImages-1 that have not failed,
 * strictly preserving gallery order.
 */
export function getAvailableSlideIndices(state: CarouselState): number[] {
  const available: number[] = [];
  for (let i = 0; i < state.totalImages; i++) {
    if (!state.failedIndices.has(i)) {
      available.push(i);
    }
  }
  return available;
}
