const PATHS: Record<string, string> = {
  library: 'M4 19V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14M10 19V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v11M15.5 8.5l3-.8a1 1 0 0 1 1.2.7l2.6 9.7M3 19h18',
  import: 'M12 4v11m0 0-4-4m4 4 4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3',
  vocabulary: 'M4 6h10M4 12h16M4 18h8M17 4l3 3-3 3',
  review: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  stats: 'M5 20V12M10 20V6M15 20v-9M20 20V9',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
};

export default function NavIcon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
