import { describe, it, expect } from 'vitest';
import { getPOICount, getImagesProcessedCount } from '../dashboardData';

describe('Defect and SLA Health Logic', () => {
  describe('SLA Health % Calculation', () => {
    // Formula: ((Total POIs - Total Defects) / Total POIs) * 100%
    const computeHealth = (totalPoi: number, totalDefects: number): string | null => {
      if (totalPoi <= 0) return null;
      if (totalDefects <= 0) return '100.0';
      return Math.max(0, ((totalPoi - totalDefects) / totalPoi) * 100).toFixed(1);
    };

    it('returns 100.0% when defect count is 0', () => {
      expect(computeHealth(273, 0)).toBe('100.0');
    });

    it('computes accurate health percentage using Total POIs in denominator', () => {
      // 273 Total POIs with 5 defects -> (268 / 273) * 100 = 98.168% -> '98.2'
      expect(computeHealth(273, 5)).toBe('98.2');
      // 273 Total POIs with 12 defects -> (261 / 273) * 100 = 95.604% -> '95.6'
      expect(computeHealth(273, 12)).toBe('95.6');
      // 100 Total POIs with 10 defects -> 90.0%
      expect(computeHealth(100, 10)).toBe('90.0');
    });

    it('clamps health to 0.0 when defects exceed total POIs', () => {
      expect(computeHealth(50, 60)).toBe('0.0');
    });

    it('returns null when total POIs is 0', () => {
      expect(computeHealth(0, 0)).toBeNull();
    });
  });

  describe('Defect Preservation with 0 Storage-Verified Images', () => {
    it('does not clamp defects to 0 when storage frames are 0 but poiCount exists', () => {
      const dailyItem = {
        subgrid: 'N94E70',
        imagesProcessed: 0, // Storage verified is 0 (images uploading/pending sync)
        poiCount: 100,      // 100 POI stations staged in DB
        defectCount: 4,     // 4 defects flagged in Batch Acquisition QC
        imagesDefected: 4
      };

      const frameCount = getImagesProcessedCount(dailyItem);
      const poiCount = getPOICount(dailyItem) || frameCount;
      const cachedDefects = dailyItem.defectCount;

      // New logic: cap by poiCount or frameCount, NOT forcing 0
      const finalDefects = (poiCount > 0 || frameCount > 0)
        ? Math.min(cachedDefects, Math.max(poiCount, frameCount))
        : cachedDefects;

      expect(frameCount).toBe(0);
      expect(poiCount).toBe(100);
      expect(finalDefects).toBe(4);
    });

    it('preserves masterlist defects when daily run frames are 0 but POI stations exist', () => {
      const subgridDailyRuns = [
        {
          subgrid: 'N94E70',
          imagesProcessed: 0,
          poiCount: 100,
          defectCount: 3,
          imagesDefected: 3
        }
      ];

      let sumDefects = 0;
      subgridDailyRuns.forEach(d => {
        const fCount = getImagesProcessedCount(d);
        const maxDailyCap = (typeof d.poiCount === 'number' && d.poiCount > 0) ? d.poiCount : (fCount > 0 ? fCount : undefined);
        const runDefects = d.defectCount || 0;
        sumDefects += maxDailyCap !== undefined ? Math.min(runDefects, maxDailyCap) : runDefects;
      });

      expect(sumDefects).toBe(3);
    });

    it('accurately sums defects across multiple subgrid daily runs', () => {
      const dailyData = [
        { subgrid: 'N94E70', imagesProcessed: 0, poiCount: 100, defectCount: 3 },
        { subgrid: 'N93E70', imagesProcessed: 104, poiCount: 164, defectCount: 5 },
        { subgrid: 'N94E71', imagesProcessed: 4, poiCount: 9, defectCount: 1 }
      ];

      const totalDefects = dailyData.reduce((sum, d) => {
        const frameCount = getImagesProcessedCount(d);
        const poiCount = getPOICount(d) || frameCount;
        const maxCap = poiCount > 0 ? poiCount : frameCount;
        return sum + Math.min(d.defectCount, maxCap);
      }, 0);

      const totalPoi = dailyData.reduce((sum, d) => sum + getPOICount(d), 0);

      expect(totalDefects).toBe(9); // 3 + 5 + 1
      expect(totalPoi).toBe(273);   // 100 + 164 + 9
      const slaHealth = Math.max(0, ((totalPoi - totalDefects) / totalPoi) * 100).toFixed(1);
      expect(slaHealth).toBe('96.7'); // ((273 - 9) / 273) * 100 = 96.70%
    });
  });
});
