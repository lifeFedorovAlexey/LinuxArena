const paths = {
  play: 'm8 5 10 7-10 7z',
  back: 'm14 5-7 7 7 7M7 12h13',
  chevron: 'm9 5 7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  code: 'm8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18',
  contract: 'M5 3h14v18H5zM8 7h8M8 11h3M8 15h8M14 11h2',
  plug: 'M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  source: 'M8 3H5v18h14V7l-4-4zM14 3v5h5M8 12h8M8 16h6',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  chip: 'M6 6h12v12H6zM9 1v5M15 1v5M9 18v5M15 18v5M1 9h5M1 15h5M18 9h5M18 15h5M10 10h4v4h-4z',
  layers: 'm12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  box: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  flag: 'M5 22V3M5 3h13l-3 5 3 5H5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  target:
    'M12 2v4M12 18v4M2 12h4M18 12h4M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  clock: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3 2',
  check: 'm5 12 4 4L19 6',
  checkCircle: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0m5 0 3 3 5-6',
  branch: 'M6 3v18M6 12c9 0 12-2 12-9M15 6l3-3 3 3',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] ?? paths.box}"/></svg>`;
