import { describe, expect, it } from 'vitest';
import {
  extractChildSubgridFromFilename,
  normalizeCsvImageFilename,
  parseCsvFilenameMetadata
} from '../csvImportMetadata';

describe('CSV import filename metadata', () => {
  it('reads dates from date-only survey filenames without treating them as subgrids', () => {
    expect(parseCsvFilenameMetadata('20220904.csv')).toEqual({ surveyDate: '2022-09-04' });
  });

  it('reads Backpack and survey-date metadata from prefixed filenames', () => {
    expect(parseCsvFilenameMetadata('BP_20220630.csv')).toEqual({
      surveyDate: '2022-06-30',
      captureEquipment: 'Backpack'
    });
  });

  it('extracts a child subgrid only when the filename contains the canonical grid code', () => {
    expect(extractChildSubgridFromFilename('N93E70-0093.jpg')).toBe('N93E70');
    expect(extractChildSubgridFromFilename('BP_20220630.csv')).toBe('');
    expect(extractChildSubgridFromFilename('20220904.csv')).toBe('');
  });

  it('normalizes image paths and case for duplicate comparison', () => {
    expect(normalizeCsvImageFilename('\\capture\\N93E70-0093.JPG')).toBe('/capture/n93e70-0093.jpg');
  });
});
