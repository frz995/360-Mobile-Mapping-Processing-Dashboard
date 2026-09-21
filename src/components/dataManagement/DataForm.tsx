import { useState } from 'react';
import { Save } from 'lucide-react';
import type { BatchLog, DailyTimeSeries } from '../../types/dashboard';
import { toISODateString } from '../../utils/dashboardData';

export const GRIDS = Array.from({ length: 12 }, (_, i) => (i + 1).toString());

export interface DataFormProps {
  initialData: BatchLog | DailyTimeSeries | null;
  dataType: 'batches' | 'daily';
  activeAuthUserName?: string;
  onSave: (data: any) => void;
  onCancel: () => void;
}

export const DataForm = ({
  initialData,
  dataType,
  activeAuthUserName,
  onSave,
  onCancel
}: DataFormProps) => {
  const [formData, setFormData] = useState<any>(
    initialData ||
    (dataType === 'batches'
      ? { date: new Date().toISOString().slice(0, 10), grid: '1', subgrid: '', imageFilename: '', images: 0, defects: 0, kmProcessed: 0, status: 'Ongoing' as const, captureEquipment: 'MMS', pic: 'Admin' }
      : {
        date: '',
        grid: '1',
        subgrid: '',
        kmProcessed: 0,
        imagesProcessed: 0,
        defectCount: 0,
        imagesDefected: 0,
        captureEquipment: 'MMS',
        pic: activeAuthUserName || 'Operator',
        publishToUSVPRO: 'in process' as const,
        action: ''
      }
    )
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const count = dataType === 'batches' ? (formData.images || 0) : (formData.imagesProcessed || 0);
        const finalKm = formData.kmProcessed > 0 ? formData.kmProcessed : Math.round((count * 0.005) * 100) / 100;
        onSave({ ...formData, kmProcessed: Math.round(finalKm * 100) / 100 });
      }}
      className="space-y-3 text-xs"
    >
      {dataType === 'batches' ? (
        <>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Date</label>
            <input
              type="date"
              value={toISODateString(formData.date)}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            />
          </div>

          {/* System Calculated Metrics Panel */}
          <div className="bg-app border border-subtle rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-subtle pb-1.5">
              <span>System Metrics</span>
              <span className="text-[9px] text-text-muted bg-inner border border-subtle px-1.5 py-0.5 rounded font-normal">System Generated</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Grid / Subgrid</span>
                <strong className="text-text-base font-semibold">{formData.grid || '—'} / {formData.subgrid || '—'}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">POI Count</span>
                <strong className="text-text-base font-semibold">{formData.poiCount ?? 0}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Images</span>
                <strong className="text-text-base font-semibold">{formData.images ?? 0} frames</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Distance</span>
                <strong className="text-text-base font-semibold">{formData.kmProcessed ?? 0} km</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Defects</span>
                <strong className="text-text-base font-semibold">{formData.defects ?? 0}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle truncate">
                <span className="text-[10px] text-text-muted block font-medium">First Image</span>
                <strong className="text-text-base font-sans text-[11px] truncate block" title={formData.imageFilename}>{formData.imageFilename || '—'}</strong>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Capture Equipment</label>
            <div className="flex items-center gap-2">
              {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setFormData({ ...formData, captureEquipment: eq })}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-medium text-xs border transition-all cursor-pointer ${formData.captureEquipment === eq
                    ? 'bg-inner border-subtle text-text-base shadow-sm font-semibold'
                    : 'bg-app border-subtle text-text-muted hover:text-text-base'
                    }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">PIC (Person In Charge)</label>
            <input
              type="text"
              value={formData.pic || ''}
              onChange={(e) => setFormData({ ...formData, pic: e.target.value })}
              placeholder="Enter PIC Name"
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Complete' | 'Ongoing' })}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            >
              <option value="Ongoing">Ongoing</option>
              <option value="Complete">Complete</option>
            </select>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Date</label>
            <input
              type="date"
              value={toISODateString(formData.date)}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            />
          </div>

          {/* System Calculated Metrics Panel */}
          <div className="bg-app border border-subtle rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-subtle pb-1.5">
              <span>System Metrics</span>
              <span className="text-[9px] text-text-muted bg-inner border border-subtle px-1.5 py-0.5 rounded font-normal">System Generated</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Grid / Subgrid</span>
                <strong className="text-text-base font-semibold">{formData.grid || '—'} / {formData.subgrid || '—'}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Images Processed</span>
                <strong className="text-text-base font-semibold">{formData.imagesProcessed ?? 0} frames</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Distance</span>
                <strong className="text-text-base font-semibold">{formData.kmProcessed ?? 0} km</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle col-span-2 sm:col-span-3">
                <span className="text-[10px] text-text-muted block font-medium">Defects</span>
                <strong className="text-text-base font-semibold">{formData.imagesDefected ?? 0}</strong>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Capture Equipment</label>
            <div className="flex items-center gap-2">
              {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setFormData({ ...formData, captureEquipment: eq })}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-medium text-xs border transition-all cursor-pointer ${formData.captureEquipment === eq
                    ? 'bg-inner border-subtle text-text-base shadow-sm font-semibold'
                    : 'bg-app border-subtle text-text-muted hover:text-text-base'
                    }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">PIC (Person In Charge)</label>
            <input
              type="text"
              value={formData.pic || ''}
              onChange={(e) => setFormData({ ...formData, pic: e.target.value })}
              placeholder="Enter PIC Name"
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Publish to WEBGIS</label>
            <select
              value={formData.publishToWebGIS || 'in process'}
              onChange={(e) => {
                const val = e.target.value as 'yes' | 'need to recheck' | 'no' | 'in process';
                setFormData({
                  ...formData,
                  publishToWebGIS: val,
                  publishToUSVPRO: val,
                  isSyncedWithSupabase: val === 'yes'
                });
              }}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            >
              <option value="yes">yes</option>
              <option value="need to recheck">need to recheck</option>
              <option value="no">no</option>
              <option value="in process">in process</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Status (Database Sync)</label>
            <input
              disabled
              type="text"
              value={formData.publishToWebGIS === 'yes' ? 'published in database' : 'ready to publish'}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-muted cursor-not-allowed"
            />
            <p className="text-[10px] text-text-muted mt-0.5">Status is updated automatically when syncing or publishing to database.</p>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2.5 pt-3 border-t border-subtle">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 bg-inner hover:bg-inner text-text-base rounded-lg font-medium text-xs transition-all cursor-pointer border border-subtle"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex items-center gap-1.5 px-4 py-1.5 bg-inner hover:bg-inner text-text-base rounded-lg font-medium text-xs transition-all cursor-pointer shadow-sm border border-subtle active:scale-95"
        >
          <Save size={14} />
          Save Changes
        </button>
      </div>
    </form>
  );
};
