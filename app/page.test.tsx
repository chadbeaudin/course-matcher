import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Home from './page';
import { SAMPLE_GPX } from '@/lib/testFixtures';

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

async function uploadSampleGpx() {
  const file = new File([SAMPLE_GPX], 'sample-race.gpx', { type: 'application/gpx+xml' });
  const input = screen.getByLabelText(/upload race gpx/i) as HTMLInputElement;
  await waitFor(() => fireEvent.change(input, { target: { files: [file] } }));
}

describe('Home page (GPX upload -> parsing -> stats/unit/theme integration)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockMatchMedia(false);
    document.documentElement.classList.remove('dark');
    Object.defineProperty(window.navigator, 'language', {
      value: 'de-DE',
      configurable: true,
    });
  });

  it('parses an uploaded GPX and displays distance/elevation/climb stats in metric by default', async () => {
    render(<Home />);
    await uploadSampleGpx();

    expect(await screen.findByText('3.6 km')).toBeInTheDocument();
    expect(screen.getByText('157 m')).toBeInTheDocument();
    expect(screen.getByText('sample-race.gpx')).toBeInTheDocument();
  });

  it('shows an error message for an invalid GPX file', async () => {
    render(<Home />);
    const file = new File(['not gpx'], 'bad.gpx', { type: 'application/gpx+xml' });
    const input = screen.getByLabelText(/upload race gpx/i) as HTMLInputElement;
    await waitFor(() => fireEvent.change(input, { target: { files: [file] } }));

    expect(await screen.findByText(/Invalid GPX file/i)).toBeInTheDocument();
  });

  it('switches displayed stats to imperial when the mi toggle is clicked', async () => {
    render(<Home />);
    await uploadSampleGpx();
    await screen.findByText('3.6 km');

    fireEvent.click(screen.getByRole('button', { name: 'mi' }));

    expect(await screen.findByText('2.2 mi')).toBeInTheDocument();
    expect(screen.getByText('516 ft')).toBeInTheDocument();
    expect(window.localStorage.getItem('course-matcher:unitSystem')).toBe('imperial');
  });

  it('toggles dark mode on the document root and persists the choice', async () => {
    render(<Home />);

    const toggle = await screen.findByRole('button', { name: /switch to dark theme/i });
    fireEvent.click(toggle);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('course-matcher:theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('course-matcher:theme')).toBe('light');
  });
});
