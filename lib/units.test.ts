import {
  detectDefaultUnitSystem,
  loadStoredUnitSystem,
  storeUnitSystem,
  kmToMi,
  miToKm,
  mToFt,
  formatDistance,
  formatElevation,
  distanceUnitLabel,
  elevationUnitLabel,
} from './units';

function setLanguage(locale: string) {
  Object.defineProperty(window.navigator, 'language', {
    value: locale,
    configurable: true,
  });
}

describe('detectDefaultUnitSystem', () => {
  it('defaults to imperial for US locale', () => {
    setLanguage('en-US');
    expect(detectDefaultUnitSystem()).toBe('imperial');
  });

  it('defaults to metric for non-imperial locales', () => {
    setLanguage('de-DE');
    expect(detectDefaultUnitSystem()).toBe('metric');
    setLanguage('en-GB');
    expect(detectDefaultUnitSystem()).toBe('metric');
  });
});

describe('stored unit system', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips through localStorage', () => {
    expect(loadStoredUnitSystem()).toBeNull();
    storeUnitSystem('imperial');
    expect(loadStoredUnitSystem()).toBe('imperial');
  });

  it('ignores garbage values', () => {
    window.localStorage.setItem('course-matcher:unitSystem', 'furlongs');
    expect(loadStoredUnitSystem()).toBeNull();
  });
});

describe('conversions and formatting', () => {
  it('converts km to mi and m to ft', () => {
    expect(kmToMi(1)).toBeCloseTo(0.621371, 5);
    expect(mToFt(1)).toBeCloseTo(3.28084, 5);
  });

  it('converts mi to km as the inverse of kmToMi', () => {
    expect(miToKm(1)).toBeCloseTo(1.60934, 4);
    expect(miToKm(kmToMi(10))).toBeCloseTo(10, 6);
  });

  it('formats distance per unit system', () => {
    expect(formatDistance(3.6, 'metric')).toBe('3.6 km');
    expect(formatDistance(3.6, 'imperial')).toBe('2.2 mi');
  });

  it('formats elevation per unit system', () => {
    expect(formatElevation(157, 'metric')).toBe('157 m');
    expect(formatElevation(157, 'imperial')).toBe('515 ft');
  });

  it('labels units correctly', () => {
    expect(distanceUnitLabel('metric')).toBe('km');
    expect(distanceUnitLabel('imperial')).toBe('mi');
    expect(elevationUnitLabel('metric')).toBe('m');
    expect(elevationUnitLabel('imperial')).toBe('ft');
  });
});
