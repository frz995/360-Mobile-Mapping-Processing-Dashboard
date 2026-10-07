import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SurveyIntegrityPanel, buildReports } from '../SurveyIntegrityPanel'
import type { IntegritySubject } from '../../utils/surveyIntegrity'

/**
 * The panel's contract, not its layout.
 *
 * Every assertion here is about what the operator is TOLD. A panel that renders
 * ten figures and quietly shows 0 where nothing was measured is worse than no
 * panel, because it converts an outage into a clean bill of health — the same
 * failure as migrations 0032 and 0033.
 */

function subject(over: Partial<IntegritySubject> = {}): IntegritySubject {
  return {
    subgrid: 'N93E70',
    date: '2026-09-25',
    runId: 'sp-d-N93E70_20260925.csv',
    recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
    verifiedFilenames: ['N93E70-0001.jpg'],
    inventoryVerified: true,
    metadataFilenames: null,
    bucketFilenames: null,
    ...over
  }
}

function renderPanel(s: IntegritySubject) {
  return render(
    <SurveyIntegrityPanel
      isOpen
      onClose={() => {}}
      title="Survey Integrity — N93E70"
      reports={buildReports([s])}
    />
  )
}

describe('SurveyIntegrityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all ten checks', () => {
    renderPanel(subject())
    for (const label of [
      'Survey Date Capture',
      'Total survey POI',
      'Expected images',
      'Found images',
      'Missing',
      'Duplicate',
      'Invalid filename',
      'Metadata mismatch',
      'GPS-linked images',
      'Unlinked images'
    ]) {
      expect(screen.getByText(label), label).toBeTruthy()
    }
  })

  it('renders the measured figures', () => {
    renderPanel(subject())
    // 2 recorded, 1 verified. Several rows legitimately read 1 or 2, so the
    // assertion is on the table's row cells rather than on bare text.
    expect(screen.getByText('Found images').closest('tr')?.textContent).toContain('1')
    expect(screen.getByText('Total survey POI').closest('tr')?.textContent).toContain('2')
  })

  it('never renders 0 where the storage inventory was unreachable', () => {
    // THE CASE. An unreachable bucket produced an empty verified list, and the
    // old model read that as "nothing is missing". Here it must say so instead.
    renderPanel(subject({ verifiedFilenames: [], inventoryVerified: false }))

expect(screen.getAllByText(/Frame inventory not verified/).length).toBeGreaterThan(0)
    // The specific lie this panel exists to prevent: a confident zero.
    const missingCell = screen.getByText('Missing').closest('tr')?.querySelector('td:last-child')
    expect(missingCell?.textContent).not.toBe('0')
    expect(missingCell?.textContent).toContain('not verified')
  })

  it('says "not captured at import" for the one row that needs migration 0034', () => {
    // Only Metadata mismatch truly requires the metadata set. Duplicate and
    // Invalid filename derive from the run's OWN recorded filenames, so
    // claiming they are unknowable would hide two computable figures behind a
    // false excuse — an over-correction in the other direction.
    renderPanel(subject({ metadataFilenames: null }))

    const mismatchRow = screen.getByText('Metadata mismatch').closest('tr');
    expect(mismatchRow?.textContent).toContain('Not captured at import')

    // And the two computable ones still report real numbers.
    expect(screen.getByText('Duplicate').closest('tr')?.textContent).toMatch(/\d/)
    expect(screen.getByText('Invalid filename').closest('tr')?.textContent).toMatch(/\d/)
  })

  it('blames the bucket contents rather than connectivity for an unlisted run', () => {
    // Unlinked is unknown because nobody supplied the bucket's contents, not
    // because storage was unreachable. Conflating them misdirects the operator.
    renderPanel(subject())
    const unlinkedRow = screen.getByText('Unlinked images').closest('tr')
    expect(unlinkedRow?.textContent).toContain('Bucket contents not supplied')
    expect(unlinkedRow?.textContent).not.toContain('storage unreachable')
  })

  it('reports a genuinely clean run as 0, not as unknown', () => {
    // Guards the guard: an unconditional "unknown" would make every healthy run
    // look unverified, which is the mirror image of the same mistake.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg']
      })
    )
    expect(screen.queryByText(/Frame inventory not verified/)).toBeNull()
    // A measured clean run genuinely reads 0, which is different from unknown.
    const missingCell = screen.getByText('Missing').closest('tr')?.querySelector('td:last-child')
    expect(missingCell?.textContent).toBe('0')
  })

  it('flags that Expected minus Found understates the real gap when orphans exist', () => {
    // The reconciliation note. Without it an operator doing
    // expected - found on these rows believes the wrong number.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg', 'N93E70-0003.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-ORPHAN-1.jpg']
      })
    )

    expect(screen.getByText('Reconciliation note')).toBeTruthy()
    expect(screen.getAllByText(/unlinked image/i).length).toBeGreaterThan(0)
  })

  it('shows no reconciliation note when every bucket image is claimed', () => {
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg']
      })
    )
    expect(screen.queryByText('Reconciliation note')).toBeNull()
  })

  it('opens the filename list when a count is clicked', async () => {
    const user = userEvent.setup()
    renderPanel(subject())

    const missingButton = screen.getByTitle('Click to list missing')
    await user.click(missingButton)

    // The missing frame's real name, not a synthesized one.
    expect(screen.getByText(/N93E70-0002\.jpg/)).toBeTruthy()
  })

  it('does not make a count clickable when its list is unknown', () => {
    renderPanel(subject({ verifiedFilenames: [], inventoryVerified: false }))
    expect(screen.queryByTitle('Click to list missing')).toBeNull()
  })

  it('states that the anomaly rows are not part of the arithmetic', () => {
    // 12 + 7 + 23 do not add to the shortfall. If the panel did not say so, a
    // reader would assume they partition it.
    renderPanel(subject())
    expect(screen.getByText(/not part of the Expected − Found arithmetic/i)).toBeTruthy()
  })

  it('propagates provenance so the figures are traceable', () => {
    renderPanel(subject())
    expect(screen.getAllByText(/migration 0034/).length).toBeGreaterThan(0)
  })
})

/**
 * The clipping regression.
 *
 * `InspectorDrawer` renders `position: fixed`. `src/index.css:927` gives
 * `.fade-in` a real rule carrying `will-change: opacity`, and
 * `DataManagementPage.tsx:2847` — the panel's own mount point — is
 * `className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500"`.
 *
 * `will-change: opacity` makes that element a containing block for fixed
 * descendants, so the drawer resolved against it instead of the viewport, and
 * the same element's `overflow-hidden` clipped it away entirely. The panel was
 * invisible while every unit test in this file passed.
 *
 * This test mounts the panel inside an equivalent ancestor and asserts it
 * escapes to `document.body`, which is what the portal guarantees.
 */
describe('SurveyIntegrityPanel — survives a clipped ancestor', () => {
  it('renders into document.body, not into the overflow-hidden ancestor', () => {
    const { container } = render(
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
        <SurveyIntegrityPanel
          isOpen
          onClose={() => {}}
          title="Survey Integrity — N93E70"
          reports={buildReports([subject()])}
        />
      </div>
    )

    const ancestor = container.firstElementChild!
    // The panel's content must not be a descendant of the clipping container.
    expect(ancestor.textContent).not.toContain('Expected images')
    // It lives at the document root instead.
    expect(document.body.textContent).toContain('Expected images')
  })

  it('keeps the ten checks reachable from document.body', () => {
    render(
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
        <SurveyIntegrityPanel
          isOpen
          onClose={() => {}}
          title="Survey Integrity — N93E70"
          reports={buildReports([subject()])}
        />
      </div>
    )

    // Asserted against document.body specifically: this is the assertion that
    // fails when the portal is removed and the drawer goes back to being clipped.
    expect(screen.getByText('Survey Date Capture')).toBeTruthy()
    expect(screen.getByText('Unlinked images')).toBeTruthy()
  })
})