import { describe, expect, it } from 'vitest';
import {
  buildSurveyRegistry,
  filterRegistryNodes,
  surveyRecordLabel,
  surveyRecordState
} from '../datasetRegistry';

const staging = (over: Record<string, any> = {}) => ({
  id: 'staging-d-N93E70_20220904.csv',
  csvFileName: '20220904.csv',
  subgrid: 'N93E70',
  date: '2022-09-04',
  poiCount: 92,
  kmProcessed: 1.4,
  imagesProcessed: 92,
  action: 'Imported (staging)',
  publishToWebGIS: 'in process',
  ...over
});

const published = (over: Record<string, any> = {}) => ({
  id: 'sp-d-N93E70_LBP_20220604',
  csvFileName: 'LBP_20220604.csv',
  subgrid: 'N93E70',
  date: '2022-06-04',
  poiCount: 96,
  action: 'Published in database',
  publishToWebGIS: 'yes',
  ...over
});

describe('surveyRecordState', () => {
  it('treats staging imports as staging', () => {
    expect(surveyRecordState(staging())).toBe('staging');
  });

  it('treats release-gate records as published', () => {
    expect(surveyRecordState(published())).toBe('published');
  });

  it('flags records carrying defects', () => {
    expect(surveyRecordState(published({ defectCount: 3 }))).toBe('defect');
    expect(surveyRecordState(staging({ defectCount: 1 }))).toBe('defect');
  });

  it('flags the staging preview marker', () => {
    expect(surveyRecordState(staging({ isStagingPreview: true }))).toBe('staging');
  });
});

describe('surveyRecordLabel', () => {
  it('strips the capture id prefixes', () => {
    expect(surveyRecordLabel('staging-d-N93E70_L20220904')).toBe('N93E70_L20220904');
    expect(surveyRecordLabel('sp-d-N93E70_LBP_20220604')).toBe('N93E70_LBP_20220604');
  });

  it('falls back to the raw id', () => {
    expect(surveyRecordLabel('custom-id')).toBe('custom-id');
    expect(surveyRecordLabel(undefined)).toBe('—');
  });
});

describe('buildSurveyRegistry', () => {
  it('groups survey records under one parent subgrid row', () => {
    const { nodes, totals } = buildSurveyRegistry({
      records: [staging(), published()]
    });
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.subgrid).toBe('N93E70');
    expect(node.surveyRecords).toBe(2);
    expect(node.children).toHaveLength(2);
    expect(node.sources.sort()).toEqual(['import', 'webgis']);
    expect(totals.subgrids).toBe(1);
    expect(totals.surveyRecords).toBe(2);
    expect(totals.pointCapture).toBe(188);
    expect(totals.imported + totals.released).toBe(2);
  });

  it('labels children by survey record without the subgrid prefix', () => {
    const { nodes } = buildSurveyRegistry({ records: [staging(), published()] });
    expect(nodes[0].children.map((c) => c.name).sort()).toEqual(['20220904.csv', 'LBP_20220604.csv']);
  });

  it('shows the real raw CSV name, never a synthetic import id', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ id: 'staging-d-N93E70_daily-csv-1790511746002-0-0', csvFileName: undefined })]
    });
    // A row staged before this fix has no csvFileName: the label degrades to the
    // id it has, never to a re-derived timestamp.
    expect(nodes[0].children[0].name).toBe('daily-csv-1790511746002-0-0');
  });

  it('prefers the real CSV name over the run key', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ id: 'staging-d-N93E70_20220904.csv', csvFileName: '20220904.csv' })]
    });
    expect(nodes[0].children[0].name).toBe('20220904.csv');
  });

  it('strips a subgrid prefix a CSV name still carries', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ csvFileName: 'N93E70_20220904.csv' })]
    });
    expect(nodes[0].children[0].name).toBe('20220904.csv');
  });

  it('keeps one raw CSV spanning two subgrids as two records', () => {
    const { nodes, totals } = buildSurveyRegistry({
      records: [
        staging({ subgrid: 'N93E70', id: 'staging-d-N93E70_20220904.csv' }),
        staging({ subgrid: 'N93E71', id: 'staging-d-N93E71_20220904.csv' })
      ]
    });
    expect(nodes.map((n) => n.subgrid).sort()).toEqual(['N93E70', 'N93E71']);
    expect(totals.surveyRecords).toBe(2);
  });

  it('normalises the subgrid key across record formats', () => {
    const { nodes } = buildSurveyRegistry({
      records: [
        staging({ subgrid: 'N93E70-20220904' }),
        staging({ id: 'staging-d-n93e70_L20220905', subgrid: 'n93e70' })
      ]
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].key).toBe('N93E70');
  });

  it('prefers the subgrid index point total over the child sum', () => {
    const { nodes } = buildSurveyRegistry({
      records: [
        staging({ id: 'staging-d-N93E70_A', poiCount: 92 }),
        staging({ id: 'staging-d-N93E70_B', poiCount: 92 })
      ],
      subgridIndex: { N93E70: { points: 288 } }
    });
    expect(nodes[0].pointCapture).toBe(288);
    expect(nodes[0].recordedPointCapture).toBe(184);
  });

  it('falls back to the child sum when the index has no count', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ poiCount: 92 })],
      subgridIndex: { N93E70: { points: 0 } }
    });
    expect(nodes[0].pointCapture).toBe(92);
  });

  it('merges differing child states into mixed', () => {
    const { nodes } = buildSurveyRegistry({ records: [staging(), published()] });
    expect(nodes[0].state).toBe('mixed');
  });

  it('keeps a uniform subgrid state', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging(), staging({ id: 'staging-d-N93E70_B', date: '2022-09-05' })]
    });
    expect(nodes[0].state).toBe('staging');
  });

  it('keeps unassigned records in their own bucket', () => {
    const { nodes } = buildSurveyRegistry({ records: [staging({ subgrid: '' })] });
    expect(nodes[0].unassigned).toBe(true);
    expect(nodes[0].subgrid).toBe('— unassigned —');
  });

  it('returns the newest record date for the parent', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ date: '2022-09-04' }), published({ date: '2023-01-02' })]
    });
    expect(nodes[0].recordDate).toBe('2023-01-02');
  });

  it('falls back to imagesProcessed when poiCount is missing', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ poiCount: undefined, imagesProcessed: 77 })]
    });
    expect(nodes[0].pointCapture).toBe(77);
  });
});

describe('grid assignment', () => {
  it('uses the grid recorded on the record', () => {
    const { nodes } = buildSurveyRegistry({ records: [staging({ grid: '2' })] });
    expect(nodes[0].children[0].grid).toBe('2');
    expect(nodes[0].children[0].gridAssigned).toBe(false);
    expect(nodes[0].grids).toEqual(['2']);
  });

  it('uses the subgrid index grid when the record has none', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging()],
      subgridIndex: { N93E70: { points: 288, grid: '3' } }
    });
    expect(nodes[0].children[0].grid).toBe('3');
    expect(nodes[0].children[0].gridAssigned).toBe(false);
  });

  it('auto-assigns sequential grids per subgrid when no grid is recorded', () => {
    const { nodes } = buildSurveyRegistry({
      records: [
        staging({ id: 'staging-d-N93E70_A' }),
        staging({ id: 'staging-d-N93E70_B' }),
        staging({ id: 'staging-d-N93E70_C' })
      ]
    });
    const grids = nodes[0].children.map((c) => c.grid);
    expect(grids).toEqual(['1', '2', '3']);
    expect(nodes[0].children.every((c) => c.gridAssigned)).toBe(true);
  });

  it('does not collide with a grid already used on the subgrid', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ id: 'staging-d-N93E70_A', grid: '1' }), staging({ id: 'staging-d-N93E70_B' })]
    });
    const grids = nodes[0].children.map((c) => c.grid).sort();
    expect(grids).toEqual(['1', '2']);
  });

  it('lists distinct grids numerically on the parent row', () => {
    const { nodes } = buildSurveyRegistry({
      records: [
        staging({ id: 'staging-d-N93E70_A', grid: '10' }),
        staging({ id: 'staging-d-N93E70_B', grid: '2' })
      ]
    });
    expect(nodes[0].grids).toEqual(['2', '10']);
  });

  it('keeps grids scoped to their own subgrid', () => {
    const { nodes } = buildSurveyRegistry({
      records: [staging({ subgrid: 'N93E70' }), staging({ id: 'staging-d-N93E71_A', subgrid: 'N93E71' })]
    });
    expect(nodes).toHaveLength(2);
    nodes.forEach((n) => expect(n.grids).toEqual(['1']));
  });
});

describe('filterRegistryNodes', () => {
  const registry = buildSurveyRegistry({
    records: [staging(), published({ subgrid: 'N93E71' })]
  });

  it('returns everything without filters', () => {
    expect(filterRegistryNodes(registry.nodes, {})).toHaveLength(2);
  });

  it('filters by source', () => {
    const onlyImport = filterRegistryNodes(registry.nodes, { source: 'import' });
    expect(onlyImport).toHaveLength(1);
    expect(onlyImport[0].subgrid).toBe('N93E70');
  });

  it('filters by state', () => {
    const publishedOnly = filterRegistryNodes(registry.nodes, { state: 'published' });
    expect(publishedOnly).toHaveLength(1);
    expect(publishedOnly[0].subgrid).toBe('N93E71');
  });

  it('searches by the raw CSV file name', () => {
    expect(filterRegistryNodes(registry.nodes, { search: 'n93e71' })).toHaveLength(1);
    expect(filterRegistryNodes(registry.nodes, { search: 'LBP' })).toHaveLength(1);
    expect(filterRegistryNodes(registry.nodes, { search: '20220904.csv' })).toHaveLength(1);
    expect(filterRegistryNodes(registry.nodes, { search: 'nothing-here' })).toHaveLength(0);
  });

  it('keeps the parent row when only a child matches the search', () => {
    const hits = filterRegistryNodes(registry.nodes, { search: '20220904.csv' });
    expect(hits).toHaveLength(1);
    expect(hits[0].children.map((c) => c.name)).toEqual(['20220904.csv']);
  });
});
