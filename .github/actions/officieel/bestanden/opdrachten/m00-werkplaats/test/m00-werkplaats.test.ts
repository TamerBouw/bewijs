import { describe, expect, it } from 'vitest';
import { begroeting, prijsInclusiefBtw } from '@opdracht/m00-werkplaats';

describe('0.5 · werkplaats', () => {
  it('prijsInclusiefBtw rekent 21% en 9% btw', () => {
    expect(prijsInclusiefBtw(100)).toBe(121);
    expect(prijsInclusiefBtw(10, 9)).toBe(10.9);
    expect(prijsInclusiefBtw(0)).toBe(0);
  });

  it('prijsInclusiefBtw rondt af op hele centen, ook naar boven', () => {
    expect(prijsInclusiefBtw(19.99)).toBe(24.19);
    expect(prijsInclusiefBtw(4.15)).toBe(5.02);
  });

  it('begroeting gebruikt de voornaam met een hoofdletter', () => {
    expect(begroeting('Daan de Vries')).toBe('Hoi Daan,');
    expect(begroeting('fleur')).toBe('Hoi Fleur,');
    expect(begroeting('jan-WILLEM')).toBe('Hoi Jan-WILLEM,');
  });

  it('begroeting negeert extra spaties en kan zonder naam', () => {
    expect(begroeting('  Sam   Bakker ')).toBe('Hoi Sam,');
    expect(begroeting('')).toBe('Hoi,');
    expect(begroeting('   ')).toBe('Hoi,');
  });
});
