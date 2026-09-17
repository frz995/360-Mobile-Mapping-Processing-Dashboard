import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ModuleTourCards } from '../showcase/ModuleTourCards';
import { HERO_SECTION } from '../showcase/showcaseMotion';
import type { SystemModule } from '../showcase/types';

const makeModules = (): SystemModule[] =>
  ['webgis', 'data', 'production', 'qaqc', 'postgis', 'reports'].map((id) => ({
    id,
    title: `${id} module & friends`,
  })) as unknown as SystemModule[];

describe('ModuleTourCards', () => {
  it('renders six separate video cards while the hero owns the viewport', () => {
    render(<ModuleTourCards modules={makeModules()} activeSection={HERO_SECTION} isMobile={false} />);

    expect(screen.getAllByTestId('module-tour-card')).toHaveLength(6);
    expect(screen.getAllByTestId('module-tour-video')).toHaveLength(6);
  });

  it('disappears as soon as the user scrolls past the hero', async () => {
    const { rerender } = render(
      <ModuleTourCards modules={makeModules()} activeSection={HERO_SECTION} isMobile={false} />
    );
    expect(screen.getAllByTestId('module-tour-card')).toHaveLength(6);

    rerender(<ModuleTourCards modules={makeModules()} activeSection={0} isMobile={false} />);

    await waitFor(() => {
      expect(screen.queryByTestId('module-tour-layer')).not.toBeInTheDocument();
    });
  });
});