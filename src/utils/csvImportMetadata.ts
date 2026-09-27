export type CsvCaptureEquipment = 'MMS' | 'Backpack' | 'Drone';

export interface CsvFilenameMetadata {
  childSubgrid?: string;
  surveyDate?: string;
  captureEquipment?: CsvCaptureEquipment;
}

export function normalizeCsvImageFilename(value?: string): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export function extractChildSubgridFromFilename(value?: string): string {
  if (!value) return '';
  const match = value.match(/([NS]\d{2}[EW]\d{2,3})/i);
  return match ? match[1].toUpperCase() : '';
}

function parseSurveyDate(value: string): string | undefined {
  const match = value.match(/(?:^|[^0-9])((?:19|20)\d{2})[-_]?(\d{2})[-_]?(\d{2})(?=$|[^0-9])/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseCsvFilenameMetadata(fileName?: string): CsvFilenameMetadata {
  const baseName = (fileName || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '';
  const tokens = baseName.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const equipmentToken = tokens.find((token) => ['BP', 'BACKPACK', 'MMS', 'DRONE', 'UAV'].includes(token));

  let captureEquipment: CsvCaptureEquipment | undefined;
  if (equipmentToken === 'BP' || equipmentToken === 'BACKPACK') captureEquipment = 'Backpack';
  else if (equipmentToken === 'MMS') captureEquipment = 'MMS';
  else if (equipmentToken === 'DRONE' || equipmentToken === 'UAV') captureEquipment = 'Drone';

  return {
    childSubgrid: extractChildSubgridFromFilename(baseName) || undefined,
    surveyDate: parseSurveyDate(baseName),
    captureEquipment
  };
}
