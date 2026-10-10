export type SubstationType = 'PE' | 'PPU' | 'SSU';
export type SubstationVoltage = '11kV' | '22kV' | '33kV';

export interface Substation3DConfig {
  enabled: boolean;
  type: SubstationType;
  voltage: SubstationVoltage;
  height: number;
  footprintWidth: number;
  footprintLength: number;
  wallColor?: string;
  roofColor?: string;
  showVoltageBadge?: boolean;
}

export const SUBSTATION_3D_PRESETS: Record<SubstationType, Omit<Substation3DConfig, 'enabled'>> = {
  PE: {
    type: 'PE',
    voltage: '11kV',
    height: 4.5,
    footprintWidth: 8,
    footprintLength: 6,
    wallColor: '#2563eb', // TNB Cobalt Blue
    roofColor: '#1d4ed8',
    showVoltageBadge: true
  },
  SSU: {
    type: 'SSU',
    voltage: '11kV',
    height: 7,
    footprintWidth: 18,
    footprintLength: 12,
    wallColor: '#475569', // Industrial Switchgear Slate
    roofColor: '#334155',
    showVoltageBadge: true
  },
  PPU: {
    type: 'PPU',
    voltage: '33kV',
    height: 10,
    footprintWidth: 35,
    footprintLength: 25,
    wallColor: '#ea580c', // High Voltage 33kV Orange
    roofColor: '#c2410c',
    showVoltageBadge: true
  }
};
