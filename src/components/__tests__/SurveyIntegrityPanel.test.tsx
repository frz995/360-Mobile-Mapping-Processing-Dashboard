import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  const recordedFilenames = over.recordedFilenames ?? ['N93E70-0001.jpg', 'N93E70-0002.jpg'];
  return {
    subgrid: 'N93E70',
    date: '2026-09-25',
    runId: 'sp-d-N93E70_20260925.csv',
    verifiedFilenames: ['N93E70-0001.jpg'],
    inventoryVerified: true,
    metadataFilenames: null,
    bucketFilenames: null,
    // Coordinates default to one distinct location per recorded frame, so "Total
    // survey POI" is a real count by default. A test that wants the figure to be
    // unknown passes `poiCoordinates: null` explicitly.
    poiCoordinates: recordedFilenames.map((_, i) => ({ lat: 3 + i * 0.001, lon: 101 + i * 0.001 })),
    ...over,
    recordedFilenames
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

    // And the two computable ones still report real numbers rather than
    // borrowing Metadata mismatch's excuse.
    const dupRow = screen.getByText('Duplicate').closest('tr');
    const invalidRow = screen.getByText('Invalid filename').closest('tr');
    expect(dupRow?.textContent).not.toContain('Not captured at import');
    expect(invalidRow?.textContent).not.toContain('Not captured at import');
    // Measured zero, so the glyph stands in for the digit and still reads "0".
    expect(dupRow?.querySelector('[aria-label="0"]')).toBeTruthy();
    expect(invalidRow?.querySelector('[aria-label="0"]')).toBeTruthy();
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
    // A measured clean run genuinely reads zero, which is different from
    // unknown. The digit is suppressed in favour of a glyph, so assert on the
    // label the glyph carries rather than on text content.
    const missingRow = screen.getByText('Missing').closest('tr')
    expect(missingRow?.querySelector('[aria-label="0"]')).toBeTruthy()
    expect(missingRow?.textContent).not.toContain('Frame inventory not verified')
  })

  it('flags that Expected minus Found understates the real gap when orphans exist', () => {
    // The reconciliation note. Without it an operator doing
    // expected - found on these rows believes the wrong number.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg', 'N93E70-0003.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-ORPHAN-1.jpg'],
        // Single-run subgrid: nothing here is claimed by a peer, so the ORPHAN-1
        // file really is unclaimed. Without this the figure is unknown, because
        // it could equally belong to a run we were not told about.
        siblingFilenames: []
      })
    )

    expect(screen.getByText('Reconciliation note')).toBeTruthy()
    expect(screen.getAllByText(/no run of this subgrid claims/i).length).toBeGreaterThan(0)
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

  it('states the arithmetic the panel actually ran', () => {
    // 12 + 7 + 23 do not add to the shortfall. If the panel did not say so, a
    // reader would assume they partition it.
    //
    // It must also name the RIGHT subtraction. The panel computes
    // `expected - GPS-linked`; the copy used to say `Expected minus Found`, which
    // understates the gap by exactly the orphan count, and a test pinned that
    // wrong wording.
    renderPanel(subject())
    expect(screen.getByText(/Expected minus GPS-linked, not Expected minus Found/i)).toBeTruthy()
    expect(screen.getByText(/are not part of that arithmetic/i)).toBeTruthy()
  })

  it('uses no em dashes or middots in its own text', () => {
    // They read as a rule or a separator in this typeface and make a phrase
    // look like two fragments. Rendered copy only; comments are irrelevant.
    const { container } = renderPanel(subject())
    const rendered = container.textContent ?? ''
    expect(rendered).not.toMatch(/[—–·]/g)
  })

  it('puts the subgrid beneath a fixed heading, not inside a dashed title', () => {
    render(
      <SurveyIntegrityPanel
        isOpen
        onClose={() => {}}
        title="Survey Integrity"
        subtitle="N93E70"
        detail="25 Sept 2026, 20260925.csv"
        reports={buildReports([subject()])}
      />
    )

    // Heading is exactly the fixed phrase; the subgrid is a separate line.
    expect(screen.getByText('Survey Integrity')).toBeTruthy()
    const header = screen.getByText('Survey Integrity').parentElement?.parentElement;
    expect(header?.textContent).toContain('N93E70');
    expect(header?.textContent).toContain('25 Sept 2026');
  })

  it('renders a measured zero as a glyph, not the digit', () => {
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg']
      })
    )

    // Zero is still zero — the glyph carries an accessible label saying so, and
    // a list-bearing row stays clickable. Only the digit is suppressed, so a
    // clean row stops competing visually with a count that needs attention.
    const zeroCell = screen.getAllByLabelText('0')
    expect(zeroCell.length).toBeGreaterThan(0)
    // And it is NOT the unknown treatment.
    expect(screen.queryByText(/Frame inventory not verified/)).toBeNull()
  })

  it('propagates provenance so the figures are traceable', () => {
    renderPanel(subject())
    expect(screen.getAllByText(/migration 0034/).length).toBeGreaterThan(0)
  })

  it('renders "% linked" instead of "received" on progress bar', () => {
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg']
      })
    )
    expect(document.body.textContent).toContain('50% linked')
    expect(document.body.textContent).not.toContain('received')
  })

  it('renders "100% linked" and green callout line when all frames are verified and clean', () => {
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        // "Clean" now requires the metadata row to have been MEASURED. Without
        // this the panel claimed "metadata records and image filenames are
        // completely linked" about a run whose metadata set was never read.
        metadataFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg']
      })
    )
    expect(document.body.textContent).toContain('100% linked')
    expect(document.body.textContent).toContain('All 2 expected frames verified and linked')
    // Green accent border is applied
    expect(document.body.querySelector('.border-emerald-500')).toBeTruthy()
  })
})

describe('SurveyIntegrityPanel — a run never adopts its sibling run images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports zero available when the subgrid folder holds only a peer run files', () => {
    // THE REPORTED CASE. N93E70 has two runs: April owns 92 frames, September
    // recorded 196 names (0093-0288) and uploaded none. The bucket listing is
    // subgrid-scoped, so it holds APRIL's files — which the panel used to report
    // as September's "unlinked orphans", inflating Available to 92 while the
    // Daily Data row said 0 frames.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0093.jpg', 'N93E70-0094.jpg'],
        verifiedFilenames: [],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        // April's recorded names: claimed elsewhere, so not orphans.
        siblingFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        metadataFilenames: ['N93E70-0093.jpg', 'N93E70-0094.jpg']
      })
    )

    const available = screen.getByText('Available Frames').closest('div')?.parentElement
    expect(available?.textContent).toContain('0')

    // Nothing of this run is present, so nothing is available.
    expect(screen.getByText('Missing').closest('tr')?.textContent).toContain('2')

    const unlinked = screen.getByText('Unlinked images').closest('tr')
    expect(unlinked?.querySelector('[aria-label="0"]')).toBeTruthy()
    expect(unlinked?.textContent).toContain('Every image here is claimed by some run')

    // And therefore no phantom reconciliation gap.
    expect(screen.queryByText('Reconciliation note')).toBeNull()
    expect(document.body.textContent).toContain('0% linked')
  })

  it('still surfaces a file no run claims', () => {
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0093.jpg'],
        verifiedFilenames: [],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-9999.jpg'],
        siblingFilenames: ['N93E70-0001.jpg'],
        metadataFilenames: ['N93E70-0093.jpg']
      })
    )

    const unlinked = screen.getByText('Unlinked images').closest('tr')
    expect(unlinked?.textContent).toContain('1 images no run of this subgrid claims')
    expect(screen.getByText('Reconciliation note')).toBeTruthy()
  })

  it('says Available includes strays when it does', () => {
    // The sub-label must not claim "POI-matched" while the figure also counts
    // files no POI claims.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-9999.jpg'],
        siblingFilenames: [],
        metadataFilenames: ['N93E70-0001.jpg']
      })
    )

    const available = screen.getByText('Available Frames').closest('div')?.parentElement
    expect(available?.textContent).toContain('Linked + unclaimed strays')
  })

  it('does not total Available as a clean figure when the peer set is unknown', () => {
    // Bucket contents without a peer list cannot separate a peer's image from a
    // stray, so the figure degrades to a labelled lower bound.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0093.jpg'],
        verifiedFilenames: [],
        bucketFilenames: ['N93E70-0001.jpg'],
        metadataFilenames: ['N93E70-0093.jpg']
      })
    )

    const available = screen.getByText('Available Frames').closest('div')?.parentElement
    expect(available?.textContent).toContain('Lower bound, bucket unread')
    expect(document.body.textContent).toContain('0% linked (lower bound)')
  })
})

/**
 * The regressions.
 *
 * Each of these is a figure the panel used to state and could not support. They
 * are grouped because the common failure is the same in every case: something
 * was rendered as a measured number when nobody had measured it.
 */
describe('SurveyIntegrityPanel — unmeasured figures never read as measured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not total the issue rows when one of them could not be evaluated', () => {
    // THE CASE. `Total Issues` summed three checks with `?? 0`, so a run whose
    // metadata predated migration 0034 rendered "Total Issues 0" two rows above
    // its own "Not evaluated" cell.
    renderPanel(subject({ metadataFilenames: null }))

    const issuesTile = screen.getByText('Total Issues').closest('div')?.parentElement
    expect(issuesTile?.textContent).not.toContain('0excluding')
    expect(issuesTile?.textContent).toContain('not evaluated')
    expect(issuesTile?.textContent).toContain('Metadata mismatch')
  })

  it('publishes the total once every contributing check is measured', () => {
    // The mirror image: with all three known, the sum must actually appear.
    renderPanel(
      subject({
        metadataFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg']
      })
    )

    const issuesTile = screen.getByText('Total Issues').closest('div')?.parentElement
    expect(issuesTile?.textContent).toContain('0')
    expect(issuesTile?.textContent).toContain('excluding missing')
  })

  it('refuses to call a run clean while an anomaly check is unevaluated', () => {
    // The clean callout asserts metadata and filenames are "completely linked,
    // valid, and matched with storage inventory". On a pre-0034 run the metadata
    // half of that sentence was never checked.
    //
    // Every frame is present, so nothing else is competing for the callout.
    renderPanel(
      subject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        bucketFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        metadataFilenames: null
      })
    )

    expect(screen.queryByText(/completely linked, valid, and matched/i)).toBeNull()
    expect(screen.getByText('Anomaly checks incomplete')).toBeTruthy()
    expect(screen.getByText(/is not a clean result/i)).toBeTruthy()
  })

  it('says linkage is unverified instead of printing 0% for an outage', () => {
    renderPanel(subject({ verifiedFilenames: [], inventoryVerified: false }))

    expect(document.body.textContent).not.toContain('0% linked')
    expect(screen.getByText('Linkage not verified')).toBeTruthy()
  })

  it('marks the percentage a lower bound when the bucket could not be split by subgrid', () => {
    // `found` is only the GPS-linked count here, so the figure understates rather
    // than equals. Printing a bare "50% linked" presents a floor as a total.
    renderPanel(subject({ bucketFilenames: null }))

    expect(screen.getByText(/50% linked \(lower bound\)/)).toBeTruthy()
  })

  it('does not show a timestamp before anything has been checked', () => {
    // The panel shipped with `lastChecked` seeded to a literal '27 Sep 2026
    // 14:32', which rendered as proof that storage had been read.
    renderPanel(subject())

    expect(screen.queryByText(/Last checked:/)).toBeNull()
    expect(screen.getByText('Not yet checked against storage')).toBeTruthy()
  })

  it('provenance does not claim a migration the run never used', () => {
    renderPanel(subject({ metadataFilenames: null }))

    const dataSource = screen.getByText('Data Source').closest('div')?.parentElement
    expect(dataSource?.textContent).toContain('Not captured for this run')
    expect(dataSource?.textContent).not.toContain('Import migration 0034')
  })
})

describe('SurveyIntegrityPanel — Run validation performs a real re-read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stamps the time only after the re-read resolves', async () => {
    const user = userEvent.setup()
    let release: (() => void) | null = null
    const onRevalidate = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve })
    )

    render(
      <SurveyIntegrityPanel
        isOpen
        onClose={() => {}}
        title="Survey Integrity"
        reports={buildReports([subject()])}
        onRevalidate={onRevalidate}
      />
    )

    await user.click(screen.getByText('Run validation'))

    // In flight: the promise has not settled, so nothing may claim it did.
    expect(onRevalidate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Last checked:/)).toBeNull()

    release!()
    await waitFor(() => expect(screen.getByText(/Last checked:/)).toBeTruthy())
  })

  it('does not stamp the time when the re-read fails', async () => {
    const user = userEvent.setup()
    const onRevalidate = vi.fn(() => Promise.reject(new Error('bucket unreachable')))

    render(
      <SurveyIntegrityPanel
        isOpen
        onClose={() => {}}
        title="Survey Integrity"
        reports={buildReports([subject()])}
        onRevalidate={onRevalidate}
      />
    )

    await user.click(screen.getByText('Run validation'))

    await waitFor(() => expect(screen.queryByText(/Last checked:/)).toBeNull())
  })

  it('refuses to run when there is nothing to re-read against', async () => {
    const user = userEvent.setup()
    renderPanel(subject())

    await user.click(screen.getByText('Run validation'))
    // Still no timestamp: the button cannot invent a measurement.
    expect(screen.queryByText(/Last checked:/)).toBeNull()
  })
})

describe('SurveyIntegrityPanel — the survey date is checked, not asserted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports a run with no date as unrecorded rather than inventing one', () => {
    // The row used to hardcode "Valid" and fall back to a literal '08 Apr 2022'.
    renderPanel(subject({ date: '' }))

    const row = screen.getByText('Survey Date Capture').closest('tr')
    expect(row?.textContent).toContain('Not recorded')
    expect(row?.textContent).not.toContain('2022')
  })

  it('rejects an unparseable date instead of ticking it', () => {
    renderPanel(subject({ date: 'not-a-date' }))

    const row = screen.getByText('Survey Date Capture').closest('tr')
    expect(row?.textContent).toContain('Unparseable')
  })

  it('rejects a survey dated in the future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 3);
    renderPanel(subject({ date: future.toISOString().slice(0, 10) }))

    const row = screen.getByText('Survey Date Capture').closest('tr')
    expect(row?.textContent).toContain('Future date')
  })

  it('formats a real date rather than echoing the raw stored string', () => {
    renderPanel(subject({ date: '2026-09-25' }))

    const row = screen.getByText('Survey Date Capture').closest('tr')
    expect(row?.textContent).toContain('Valid')
    expect(row?.textContent).toContain('25 Sept 2026')
  })
})

describe('SurveyIntegrityPanel — reconciliation and orphan reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the duplicate rows in occurrences, not filenames', () => {
    renderPanel(
      subject({
        recordedFilenames: ['A-0001.jpg', 'A-0001.jpg', 'A-0001.jpg'],
        verifiedFilenames: []
      })
    )

    const row = screen.getByText('Duplicate').closest('tr')
    expect(row?.textContent).toContain('1 filename claimed by more than one POI')
    expect(row?.textContent).toContain('2 extra claims')
  })

  it('keeps a copied list actionable by including its reason column', async () => {
    // A mismatch list copied without the metadata name is not actionable.
    const user = userEvent.setup()
    // `userEvent.setup()` installs its own clipboard stub, so this must be
    // installed after it. `Object.assign` is silently ignored on navigator
    // accessors, hence defineProperty.
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })

    renderPanel(
      subject({
        recordedFilenames: ['A-0001.jpg'],
        verifiedFilenames: ['A-0001.jpg'],
        bucketFilenames: ['A-0001.jpg'],
        metadataFilenames: ['A-9999.jpg']
      })
    )

    await user.click(screen.getByTitle('Click to list metadata mismatches'))
    await user.click(screen.getByText(/Copy \(/))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('metadata:')
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

    const ancestor = container.firstElementChild;
    // The panel's content must not be a descendant of the clipping container.
    expect(ancestor?.textContent).not.toContain('Expected images');
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