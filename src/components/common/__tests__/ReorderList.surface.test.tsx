import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReorderList, ReorderItem, ReorderHandle } from '../ReorderList';

const themesCss = readFileSync(resolve(process.cwd(), 'src/themes.css'), 'utf8');
/** Comments mention selectors and must not be parsed as rules. */
const themesRules = themesCss.replace(/\/\*[\s\S]*?\*\//g, '');

function renderList() {
  const values = ['a', 'b', 'c'];
  return render(
    <ReorderList values={values} onReorder={() => {}} as="ul">
      {values.map((value) => (
        <ReorderItem
          key={value}
          value={value}
          id={value}
          className="rounded-xl border transition-all bg-inner/40 shadow-sm"
        >
          <ReorderHandle aria-label={`Reorder ${value}`} />
        </ReorderItem>
      ))}
    </ReorderList>
  );
}

function ruleBody(css: string, selector: string): string {
  const body = css
    .split('}')
    .map((rule) => {
      const brace = rule.indexOf('{');
      if (brace === -1) return null;
      const ruleSelector = rule.slice(0, brace).trim();
      return ruleSelector === selector ? rule.slice(brace + 1).trim() : null;
    })
    .find((found) => found !== null);

  if (body === undefined || body === null) {
    throw new Error(`themes.css has no top-level rule for "${selector}"`);
  }
  return body;
}

/** Selectors that a neumorphic `li` well applies to, keyed by selector text. */
function liBgInnerSelectors(css: string): string[] {
  return css
    .split('}')
    .map((rule) => rule.slice(0, rule.indexOf('{')).trim())
    .filter((selector) => selector.includes('li[class*="bg-inner"]'));
}

describe('ReorderList surface-style drag contract', () => {
  it('tags the group and every row so surface styles can bind to them', () => {
    const { container } = renderList();

    expect(container.querySelectorAll('[data-reorder-group]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-reorder-item]')).toHaveLength(3);
  });

  it('renders rows as list items carrying the reorder hook', () => {
    const { container } = renderList();

    const row = container.querySelector('[data-reorder-item]');
    expect(row?.tagName).toBe('LI');
    expect(row?.className).toContain('bg-inner/40');
  });

  it('leaves the dragging hook off until a drag starts', () => {
    const { container } = renderList();

    expect(container.querySelectorAll('[data-reorder-dragging]')).toHaveLength(0);
  });

  it('never lets a neumorphic li well pin transform on a row', () => {
    // Framer Motion writes `transform` inline every frame while dragging and
    // while siblings reflow. A `transform: ... !important` stylesheet rule beats
    // that inline style, so the order still commits on drop but nothing animates.
    const unguarded = liBgInnerSelectors(themesRules).filter(
      (selector) => !selector.includes(':not([data-reorder-item])')
    );

    expect(unguarded).toEqual([]);
  });

  it('styles the neumorphic row through box-shadow, not transform', () => {
    expect(ruleBody(themesRules, '[data-theme][data-surface="neumorphism"] li[data-reorder-item]')).toMatch(
      /box-shadow/
    );
    expect(ruleBody(themesRules, '[data-theme][data-surface="neumorphism"] li[data-reorder-item]')).not.toMatch(
      /(^|;)\s*transform\s*:/
    );
  });

  it('keeps transform out of the row transition so drag tracks the pointer', () => {
    // Tailwind's `transition-all` on the row re-interpolates every inline
    // transform write, so the row trails the cursor instead of tracking it.
    const rest = ruleBody(themesRules, '[data-reorder-item]');
    expect(rest).toMatch(/transition-property:\s*box-shadow[^;]*!important/);
    expect(rest).not.toMatch(/transition-property:[^;]*\ball\b/);

    expect(ruleBody(themesRules, '[data-reorder-item][data-reorder-dragging]')).toMatch(
      /transition-property:\s*none\s*!important/
    );
  });
});