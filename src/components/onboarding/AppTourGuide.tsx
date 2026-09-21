import { X, ChevronRight, Map as MapIcon } from 'lucide-react';

export interface TourStepItem {
  step: number;
  title: string;
  desc: string;
  highlight: string;
}

export const TOUR_STEPS: TourStepItem[] = [
  {
    step: 1,
    title: '1. Executive KPI Summary Cards',
    desc: 'Real-time monitoring of total trajectory distance (KM), 360° panorama frame counts, active survey subgrids, and overall defect SLA pass rates.',
    highlight: 'Top executive summary cards'
  },
  {
    step: 2,
    title: '2. Interactive WebGIS Map & Layer Controls',
    desc: 'Spatial trajectory inspection on Leaflet. Click any subgrid to filter frames. Toggle subgrid bounding boxes, trajectory lines, and high-voltage grid overlays.',
    highlight: 'Interactive WebGIS Map canvas'
  },
  {
    step: 3,
    title: '3. 360° Equirectangular StreetView Inspector',
    desc: 'High-definition 360° camera inspection. Step along trajectory points, review automated defect flags, and complete YES/NO QA verification questionnaires.',
    highlight: '360° Panorama StreetView panel'
  },
  {
    step: 4,
    title: '4. Daily Survey Progress & Supabase DB Control',
    desc: 'Filter daily survey passes by column (Date, PIC, Subgrid), perform passcode-protected record edits or deletions, and publish live records to Supabase PostgreSQL.',
    highlight: 'Daily progress data table'
  },
  {
    step: 5,
    title: '5. Audit Trail Logs & Real-Time Notifications',
    desc: 'Inspect chronological system activity logs (create, edit, delete, publish, error) with date-range filters, and monitor live database publish notifications.',
    highlight: 'Header Audit Log & Notification controls'
  },
  {
    step: 6,
    title: '6. Navigation Sidebar Panel Overview',
    desc: 'The central navigation bar provides fast access to all operational canvases, database management tools, system settings, and interactive help controls.',
    highlight: 'Navigation sidebar strip'
  },
  {
    step: 7,
    title: '7. Main Dashboard Canvas Switcher',
    desc: 'Click this button to return instantly to the primary WebGIS view, featuring spatial trajectory maps, 360° StreetView inspectors, and daily progress metrics.',
    highlight: 'Main Dashboard nav button'
  },
  {
    step: 8,
    title: '8. PostGIS Data Management & Layer Catalog',
    desc: 'Access the dedicated PostGIS Data Management canvas to inspect raw trajectory tables, import survey CSVs, and configure subgrid masterlists.',
    highlight: 'Data Management nav button'
  },
  {
    step: 9,
    title: '9. Instant Map & Trajectory Cache Refresh',
    desc: 'Triggers an instant cache purge and re-sync with Supabase PostgreSQL, reloading all trajectory polylines, panorama nodes, and subgrid boundaries.',
    highlight: 'Refresh Map nav button'
  },
  {
    step: 10,
    title: '10. Project & Database Settings',
    desc: 'Open Section 7 & Section 8 settings to configure Masterlist subgrid deduplication rules, daily survey run preservation policies, and QA defect SLA benchmarks.',
    highlight: 'Project Settings nav button'
  },
  {
    step: 11,
    title: '11. About Dashboard & System Specifications',
    desc: 'View comprehensive system specs, including PostGIS mapping engines, Supabase PostgreSQL database architecture, coordinate reference systems (EPSG:4326, 3857, 3375), and versioning.',
    highlight: 'About Dashboard nav button'
  },
  {
    step: 12,
    title: '12. Expandable Navigation Panel & Fluid Micro-Animations',
    desc: 'Click the bottom chevron toggle to expand or collapse the navigation sidebar with silky-smooth cubic-bezier transitions, label sliding animations, and glowing fluid active dots.',
    highlight: 'Expand / Collapse panel toggle button'
  }
];

export interface AppTourGuideProps {
  tourStep: number | null;
  setTourStep: (step: number | null) => void;
  tourFirstRunOpen: boolean;
  onDismissFirstRun: () => void;
  onStartTour: () => void;
  isHelpGuideOpen?: boolean;
}

export const AppTourGuide = ({
  tourStep,
  setTourStep,
  tourFirstRunOpen,
  onDismissFirstRun,
  onStartTour,
  isHelpGuideOpen = false
}: AppTourGuideProps) => {
  return (
    <>
      {/* FIRST-RUN ONBOARDING NUDGE (auto-suggested once, dismissible) */}
      {tourFirstRunOpen && tourStep === null && !isHelpGuideOpen && (
        <div className="fixed bottom-6 right-6 z-[99998] w-[340px] max-w-[calc(100vw-2rem)] bg-card border border-subtle rounded-2xl shadow-2xl p-4 text-text-base backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-500/15 text-sky-400">
                <MapIcon style={{ width: 14, height: 14 }} />
              </span>
              <h4 className="text-xs font-bold text-text-base tracking-wide">
                New here? Take the interactive tour
              </h4>
            </div>
            <button
              onClick={onDismissFirstRun}
              className="text-text-muted hover:text-text-base p-0.5 rounded transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-text-muted leading-relaxed mb-3.5">
            A quick 12-step guided walk-through of the Map, 360° street view, Daily progress tables, and Audit logs.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onStartTour}
              className="flex-1 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-sm text-center"
            >
              Start Tour
            </button>
            <button
              onClick={onDismissFirstRun}
              className="px-3 py-1.5 bg-inner hover:bg-inner text-text-muted hover:text-text-base text-xs font-medium rounded-lg border border-subtle transition-colors cursor-pointer"
            >
              Maybe Later
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE STEP SPOTLIGHT MODAL */}
      {tourStep !== null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90vw] max-w-lg bg-card border border-subtle rounded-2xl shadow-2xl z-[99999] p-4 text-text-base backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between border-b border-subtle pb-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="bg-inner text-text-base border border-subtle text-[10px] font-sans font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                Step {tourStep} of {TOUR_STEPS.length}
              </span>
              <h3 className="text-xs font-bold text-text-base tracking-wide">
                {TOUR_STEPS[tourStep - 1].title}
              </h3>
            </div>
            <button
              onClick={() => setTourStep(null)}
              className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors cursor-pointer"
              title="End Guided Tour"
            >
              <X size={16} />
            </button>
          </div>

          <p className="text-xs text-text-base leading-relaxed mb-4">
            {TOUR_STEPS[tourStep - 1].desc}
          </p>

          {/* Step Dots Indicator */}
          <div className="flex items-center justify-center gap-1.5 mb-3">
            {TOUR_STEPS.map((s) => (
              <button
                key={s.step}
                onClick={() => setTourStep(s.step)}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  tourStep === s.step ? 'w-5 bg-slate-200' : 'w-1.5 bg-inner hover:bg-slate-500'
                }`}
                title={`Go to step ${s.step}: ${s.title}`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-subtle">
            <span className="text-[10px] text-text-muted font-sans">
              Focus: <strong className="text-text-base">{TOUR_STEPS[tourStep - 1].highlight}</strong>
            </span>

            <div className="flex items-center gap-2">
              {tourStep > 1 && (
                <button
                  onClick={() => setTourStep(tourStep - 1)}
                  className="px-3 py-1 bg-inner hover:bg-inner text-text-base border border-subtle text-xs font-medium rounded-lg transition-all cursor-pointer"
                >
                  Previous
                </button>
              )}
              {tourStep < TOUR_STEPS.length ? (
                <button
                  onClick={() => setTourStep(tourStep + 1)}
                  className="px-3.5 py-1 bg-inner hover:bg-inner text-text-base border border-subtle text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                >
                  Next Step <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={() => setTourStep(null)}
                  className="px-3.5 py-1 bg-inner hover:bg-inner text-emerald-400 border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  Complete Tour ✓
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
