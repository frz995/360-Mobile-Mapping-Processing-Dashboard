import { describe, it, expect, beforeEach } from 'vitest';
import { inspectionStore } from '../useInspectionStore';

describe('useInspectionStore (global singleton inspection store)', () => {
  beforeEach(() => {
    inspectionStore.reset();
  });

  it('initializes with default values', () => {
    const state = inspectionStore.getState();
    expect(state.activePointId).toBeNull();
    expect(state.activeCoordinate).toBeNull();
    expect(state.activeHeading).toBeNull();
    expect(state.activeSubgrid).toBeNull();
    expect(state.activeDefectCategory).toBe('all');
    expect(state.isDrawerOpen).toBe(false);
    expect(state.drawerWidth).toBe(420);
  });

  it('sets active point and opens drawer automatically', () => {
    inspectionStore.setActivePoint({
      id: 'PT-100',
      lat: 3.139,
      lng: 101.686,
      heading: 180,
      subgrid: '01AA'
    });

    const state = inspectionStore.getState();
    expect(state.activePointId).toBe('PT-100');
    expect(state.activeCoordinate).toEqual([3.139, 101.686]);
    expect(state.activeHeading).toBe(180);
    expect(state.activeSubgrid).toBe('01AA');
    expect(state.isDrawerOpen).toBe(true);
  });

  it('notifies subscribers on state change', () => {
    let callCount = 0;
    const unsubscribe = inspectionStore.subscribe(() => {
      callCount++;
    });

    inspectionStore.setActiveDefectCategory('blurry');
    expect(callCount).toBe(1);
    expect(inspectionStore.getState().activeDefectCategory).toBe('blurry');

    inspectionStore.toggleDrawer();
    expect(callCount).toBe(2);
    expect(inspectionStore.getState().isDrawerOpen).toBe(true);

    unsubscribe();
    inspectionStore.toggleDrawer();
    expect(callCount).toBe(2); // no further calls after unsubscribe
  });

  it('clamps drawer width between 320px and 800px', () => {
    inspectionStore.setDrawerWidth(100);
    expect(inspectionStore.getState().drawerWidth).toBe(320);

    inspectionStore.setDrawerWidth(1200);
    expect(inspectionStore.getState().drawerWidth).toBe(800);

    inspectionStore.setDrawerWidth(500);
    expect(inspectionStore.getState().drawerWidth).toBe(500);
  });

  it('clears active point and coordinates on clearSelection', () => {
    inspectionStore.setActivePoint({
      id: 'PT-200',
      lat: 5.416,
      lng: 100.332,
      subgrid: '02BB'
    });

    inspectionStore.clearSelection();
    const state = inspectionStore.getState();
    expect(state.activePointId).toBeNull();
    expect(state.activeCoordinate).toBeNull();
    expect(state.activeSubgrid).toBeNull();
  });
});
