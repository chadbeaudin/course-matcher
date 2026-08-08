import { detectDefaultTheme, loadStoredTheme, storeTheme, applyTheme } from './theme';

function mockMatchMedia(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe('detectDefaultTheme', () => {
  it('returns dark when the OS prefers dark', () => {
    mockMatchMedia(true);
    expect(detectDefaultTheme()).toBe('dark');
  });

  it('returns light when the OS prefers light', () => {
    mockMatchMedia(false);
    expect(detectDefaultTheme()).toBe('light');
  });
});

describe('stored theme', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips through localStorage', () => {
    expect(loadStoredTheme()).toBeNull();
    storeTheme('dark');
    expect(loadStoredTheme()).toBe('dark');
  });

  it('ignores garbage values', () => {
    window.localStorage.setItem('course-matcher:theme', 'sepia');
    expect(loadStoredTheme()).toBeNull();
  });
});

describe('applyTheme', () => {
  afterEach(() => document.documentElement.classList.remove('dark'));

  it('adds the dark class for dark theme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes the dark class for light theme', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
