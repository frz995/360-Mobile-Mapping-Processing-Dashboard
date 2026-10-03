import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoadCatalogPanel } from '../RoadCatalogPanel';
import type { CatalogVectorLayer } from '../../../utils/gisImportParser';

function makeLayer(id: string, name: string): CatalogVectorLayer {
  return {
    id,
    name,
    format: 'geojson',
    geojson: { type: 'FeatureCollection', features: [] },
    color: '#38bdf8',
    opacity: 0.85,
    strokeWidth: 3,
    visible: true,
    featureCount: 1,
    geometryType: 'LineString',
    bbox: null,
    uploadedAt: '2026-01-01T00:00:00.000Z',
    hasRoadLines: false
  } as CatalogVectorLayer;
}

/** Fresh spies per render so mock.calls[0] belongs to the current test. */
function renderPanel(layers: CatalogVectorLayer[]) {
  const props = {
    catalogLayers: layers,
    systemStyles: {
      districtBoundary: { visible: true, color: '#fff', opacity: 1, strokeWidth: 1 },
      capturedPoints: { visible: true, opacity: 1, pointRadius: 4 },
      roadPlan: { visible: true, color: '#0f0', opacity: 1, strokeWidth: 3 },
      dimOutside: { visible: false, color: '#000', opacity: 0.5 }
    },
    onUpdateSystemStyles: vi.fn(),
    onUpdateCatalogLayer: vi.fn(),
    onReorderCatalogLayers: vi.fn(),
    onRemoveCatalogLayer: vi.fn(),
    onZoomToLayer: vi.fn()
  };
  const utils = render(<RoadCatalogPanel {...(props as any)} />);
  return { props, ...utils };
}

const upButtons = () => screen.getAllByRole('button', { name: 'Move layer up' });
const downButtons = () => screen.getAllByRole('button', { name: 'Move layer down' });

describe('RoadCatalogPanel imported-layer reorder', () => {
  it('renders one drag handle per imported layer', () => {
    renderPanel([makeLayer('L1', 'Roads'), makeLayer('L2', 'Districts')]);

    expect(screen.getAllByTestId('reorder-drag-handle')).toHaveLength(2);
    expect(screen.getByLabelText('Reorder Roads')).toBeInTheDocument();
    expect(screen.getByLabelText('Reorder Districts')).toBeInTheDocument();
  });

  it('disables move-up on the first layer and move-down on the last', () => {
    renderPanel([makeLayer('L1', 'Roads'), makeLayer('L2', 'Districts')]);

    expect(upButtons()[0]).toBeDisabled();
    expect(downButtons()[0]).toBeEnabled();
    expect(upButtons()[1]).toBeEnabled();
    expect(downButtons()[1]).toBeDisabled();
  });

  it('emits the swapped order when moving a layer down', () => {
    const { props } = renderPanel([makeLayer('L1', 'Roads'), makeLayer('L2', 'Districts')]);

    fireEvent.click(downButtons()[0]);

    expect(props.onReorderCatalogLayers).toHaveBeenCalledTimes(1);
    expect(props.onReorderCatalogLayers.mock.calls[0][0].map((l: CatalogVectorLayer) => l.id)).toEqual([
      'L2',
      'L1'
    ]);
  });

  it('emits the swapped order when moving a layer up', () => {
    const { props } = renderPanel([makeLayer('L1', 'Roads'), makeLayer('L2', 'Districts')]);

    fireEvent.click(upButtons()[1]);

    expect(props.onReorderCatalogLayers.mock.calls[0][0].map((l: CatalogVectorLayer) => l.id)).toEqual([
      'L2',
      'L1'
    ]);
  });

  it('moves Alt+ArrowDown from the drag handle', () => {
    const { props } = renderPanel([makeLayer('L1', 'Roads'), makeLayer('L2', 'Districts')]);

    fireEvent.keyDown(screen.getByLabelText('Reorder Roads'), { key: 'ArrowDown', altKey: true });

    expect(props.onReorderCatalogLayers.mock.calls[0][0].map((l: CatalogVectorLayer) => l.id)).toEqual([
      'L2',
      'L1'
    ]);
  });
});