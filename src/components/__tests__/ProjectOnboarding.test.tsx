import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ProjectOnboarding } from '../ProjectOnboarding';
import { TRANSLATIONS } from '../../lib/i18n';
import type { UserProject } from '../../services/projects';

const translate = (key: string) => TRANSLATIONS.en[key] || key;

const mockProject: UserProject = {
  id: 'proj-1',
  name: 'Federal Route 1 Survey 2025',
  description: 'MMS Pavement capture',
  contractCode: 'JKR/HQ/2025-01',
  clientName: 'JKR Malaysia',
  region: 'peninsular_malaysia',
  status: 'active',
  scope: {
    crs: 'EPSG:3168',
    region: 'peninsular_malaysia',
    bbox: [99.6, 1.2, 104.6, 6.8],
    basemap: 'dark',
    equipment: 'Vehicle MMS Rig',
    targetKm: 50,
    targetImages: 10000
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: new Date().toISOString()
};

describe('ProjectOnboarding (StartGlobal architecture)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when stage is idle', () => {
    const { container } = render(
      <ProjectOnboarding
        stage="idle"
        projects={[]}
        projectsLoaded={true}
        translate={translate}
        onContinue={vi.fn()}
        onCreateProject={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders welcome screen when stage is welcome', () => {
    render(
      <ProjectOnboarding
        stage="welcome"
        userName="Ahmad Faiz"
        projects={[]}
        projectsLoaded={true}
        translate={translate}
        onContinue={vi.fn()}
        onCreateProject={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByText(/Ahmad Faiz/i)).toBeInTheDocument();
    expect(screen.getByText(/Proceed to Workspace/i)).toBeInTheDocument();
  });

  it('renders resume screen for returning users with existing projects', () => {
    const onContinue = vi.fn();
    render(
      <ProjectOnboarding
        stage="pick"
        userName="Ahmad Faiz"
        projects={[mockProject]}
        projectsLoaded={true}
        activeProject={mockProject}
        translate={translate}
        onContinue={onContinue}
        onCreateProject={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText('Federal Route 1 Survey 2025')).toBeInTheDocument();
    expect(screen.getByText('JKR/HQ/2025-01')).toBeInTheDocument();

    // Click resume card
    fireEvent.click(screen.getByText('Federal Route 1 Survey 2025'));
    expect(onContinue).toHaveBeenCalledWith(mockProject);
  });

  it('navigates through the 5-step StartGlobal wizard when creating a new project', async () => {
    const onCreateProject = vi.fn().mockResolvedValue({
      success: true,
      value: { ...mockProject, id: 'new-proj-2', name: 'West Coast Expressway MMS' }
    });
    const onContinue = vi.fn();

    render(
      <ProjectOnboarding
        stage="pick"
        userName="Surveyor User"
        projects={[mockProject]}
        projectsLoaded={true}
        translate={translate}
        onContinue={onContinue}
        onCreateProject={onCreateProject}
        onSkip={vi.fn()}
      />
    );

    // Switch from resume mode to wizard mode
    const newCampaignBtn = screen.getByText(/Create Project/i);
    fireEvent.click(newCampaignBtn);

    // Step 1: Define Project
    expect(screen.getByText('Define Project')).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText(/Federal Route 1 MMS Survey/i);
    fireEvent.change(nameInput, { target: { value: 'West Coast Expressway MMS' } });

    // Live blueprint updates
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getAllByText('West Coast Expressway MMS').length).toBeGreaterThan(0);

    // Proceed to Step 2: Spatial Scope
    const continueBtn = screen.getByText('Continue');
    fireEvent.click(continueBtn);

    expect(screen.getByText('Geodetic Spatial Scope')).toBeInTheDocument();
    expect(screen.getAllByText('Peninsular Malaysia').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sabah & Labuan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sarawak').length).toBeGreaterThan(0);

    // Select Sabah
    fireEvent.click(screen.getAllByText('Sabah & Labuan')[0]);
    expect(screen.getAllByText('EPSG:29873').length).toBeGreaterThan(0);

    // Proceed to Step 3: Map Project Boundary & District Selection
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Map Project Boundary')).toBeInTheDocument();
    expect(screen.getByText('Malaysia Region')).toBeInTheDocument();

    // Select a region from the dropdown (e.g. Sabah)
    const regionSelect = screen.getByRole('combobox');
    fireEvent.change(regionSelect, { target: { value: 'state:sabah' } });

    // Proceed to Step 4: Workspace Theme Selection
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Workspace Theme & Style')).toBeInTheDocument();
    expect(screen.getAllByText('Titanium Graphite').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Monochrome Slate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Naval Steel').length).toBeGreaterThan(0);

    // Select Naval Steel theme
    fireEvent.click(screen.getAllByText('Naval Steel')[0]);

    // Proceed to Step 5: Review & Launch
    fireEvent.click(screen.getByText('Continue'));
    expect(screen.getByText('Review Campaign Manifest')).toBeInTheDocument();
    expect(screen.getByText('Ready to Launch')).toBeInTheDocument();

    // Click Launch Workspace
    const launchBtn = screen.getByText(/Initialize & Launch Workspace/i);
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(onCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'West Coast Expressway MMS',
          region: 'sabah',
          status: 'active',
          scope: expect.objectContaining({
            projectBoundary: expect.any(Object),
            theme: expect.any(String)
          })
        })
      );
    });
  });

  it('renders loading stage with checklist steps', () => {
    render(
      <ProjectOnboarding
        stage="loading"
        projects={[]}
        projectsLoaded={true}
        translate={translate}
        onContinue={vi.fn()}
        onCreateProject={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText(/Getting ready for your workspace/i)).toBeInTheDocument();
  });

  it('triggers onBackToLanding when the Back button next to Skip for now is clicked', () => {
    const onBackToLanding = vi.fn();
    render(
      <ProjectOnboarding
        stage="pick"
        userName="Ahmad Faiz"
        projects={[mockProject]}
        projectsLoaded={true}
        translate={translate}
        onContinue={vi.fn()}
        onCreateProject={vi.fn()}
        onSkip={vi.fn()}
        onBackToLanding={onBackToLanding}
      />
    );

    const backBtn = screen.getByRole('button', { name: /^Back$/i });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(onBackToLanding).toHaveBeenCalledTimes(1);
  });
});
