import { useSyncExternalStore } from 'react';

export type DefectCategory = 'all' | 'blurry' | 'obstruction' | 'badGps';

export interface InspectionPoint {
  id: string;
  lat?: number;
  lng?: number;
  heading?: number;
  subgrid?: string;
  filename?: string;
}

export interface InspectionStoreState {
  activePointId: string | null;
  activeCoordinate: [number, number] | null;
  activeHeading: number | null;
  activeSubgrid: string | null;
  activeDefectCategory: DefectCategory;
  isDrawerOpen: boolean;
  drawerWidth: number;
}

const INITIAL_STATE: InspectionStoreState = {
  activePointId: null,
  activeCoordinate: null,
  activeHeading: null,
  activeSubgrid: null,
  activeDefectCategory: 'all',
  isDrawerOpen: false,
  drawerWidth: 420
};

let currentState: InspectionStoreState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

export const inspectionStore = {
  getState: (): InspectionStoreState => currentState,

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setActivePoint: (point: InspectionPoint | null) => {
    if (!point) {
      currentState = {
        ...currentState,
        activePointId: null,
        activeCoordinate: null,
        activeHeading: null
      };
      notify();
      return;
    }

    const coord: [number, number] | null =
      typeof point.lat === 'number' && typeof point.lng === 'number'
        ? [point.lat, point.lng]
        : currentState.activeCoordinate;

    currentState = {
      ...currentState,
      activePointId: point.id,
      activeCoordinate: coord,
      activeHeading: typeof point.heading === 'number' ? point.heading : currentState.activeHeading,
      activeSubgrid: point.subgrid || currentState.activeSubgrid,
      isDrawerOpen: true
    };
    notify();
  },

  setActiveCoordinate: (coord: [number, number] | null) => {
    currentState = { ...currentState, activeCoordinate: coord };
    notify();
  },

  setActiveHeading: (heading: number | null) => {
    currentState = { ...currentState, activeHeading: heading };
    notify();
  },

  setActiveSubgrid: (subgrid: string | null) => {
    currentState = { ...currentState, activeSubgrid: subgrid };
    notify();
  },

  setActiveDefectCategory: (category: DefectCategory) => {
    currentState = { ...currentState, activeDefectCategory: category };
    notify();
  },

  setDrawerOpen: (open: boolean) => {
    currentState = { ...currentState, isDrawerOpen: open };
    notify();
  },

  toggleDrawer: () => {
    currentState = { ...currentState, isDrawerOpen: !currentState.isDrawerOpen };
    notify();
  },

  setDrawerWidth: (width: number) => {
    const clamped = Math.max(320, Math.min(800, width));
    currentState = { ...currentState, drawerWidth: clamped };
    notify();
  },

  clearSelection: () => {
    currentState = {
      ...currentState,
      activePointId: null,
      activeCoordinate: null,
      activeHeading: null,
      activeSubgrid: null
    };
    notify();
  },

  reset: () => {
    currentState = { ...INITIAL_STATE };
    notify();
  }
};

/**
 * React hook to consume the global inspection store.
 * Supports an optional selector function for fine-grained re-renders.
 */
export function useInspectionStore<T = InspectionStoreState>(
  selector?: (state: InspectionStoreState) => T
): T {
  const getSelectedSnapshot = () => {
    const state = inspectionStore.getState();
    return selector ? selector(state) : (state as unknown as T);
  };

  return useSyncExternalStore(
    inspectionStore.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot
  );
}
