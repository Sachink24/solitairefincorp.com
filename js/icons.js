/* Minimal stroke-based line icons — hand-authored, brand-colored, no external
   image assets. Each entry is inner SVG markup on a 0 0 24 24 viewBox. */
const SFM_ICONS = {
  home: `<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M9.5 19.5v-6h5v6"/>`,
  building: `<rect x="6" y="3" width="12" height="18" rx="0.5"/><path d="M9 7h1.4M13.6 7H15M9 11h1.4M13.6 11H15M9 15h1.4M13.6 15H15"/><path d="M10 21v-3h4v3"/>`,
  user: `<circle cx="12" cy="8.2" r="3.4"/><path d="M5 20c0-4 3.2-6.2 7-6.2s7 2.2 7 6.2"/>`,
  briefcase: `<rect x="3" y="8" width="18" height="11" rx="1.2"/><path d="M8.5 8V6.3A1.8 1.8 0 0 1 10.3 4.5h3.4A1.8 1.8 0 0 1 15.5 6.3V8"/><path d="M3 13.2h18"/>`,
  cog: `<circle cx="12" cy="12" r="7.5" stroke-dasharray="1.6 2.4"/><circle cx="12" cy="12" r="3"/>`,
  refresh: `<path d="M4.5 12a7.5 7.5 0 0 1 13-5.2M19.5 5v4.8h-4.8"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.2M4.5 19v-4.8h4.8"/>`,
  layers: `<path d="M12 3 20.5 8 12 13 3.5 8Z"/><path d="M3.5 12 12 17l8.5-5"/><path d="M3.5 16 12 21l8.5-5"/>`,
  wrench: `<path d="M14.7 6.3a3.6 3.6 0 0 0-4.9 4.4L4.5 15l1.9 1.9 4.3-5.3a3.6 3.6 0 0 0 4.4-4.9Z"/>`,
  truck: `<rect x="2.5" y="8" width="12.5" height="8.5" rx="0.6"/><path d="M15 11h3.6l3 3v2.5H15Z"/><circle cx="7" cy="18.3" r="1.6"/><circle cx="17.5" cy="18.3" r="1.6"/>`,
  exchange: `<path d="M4 8h13.5M14 4.3 17.7 8 14 11.7"/><path d="M20 16H6.5M10 12.3 6.3 16 10 19.7"/>`,
  "trending-up": `<polyline points="3.5,17 9,11.2 13,15 20.5,6.7"/><polyline points="14.5,6.7 20.5,6.7 20.5,12.7"/>`,
  "shield-check": `<path d="M12 3.3 19 6.2v5.6c0 5-3.3 7.6-7 9-3.7-1.4-7-4-7-9V6.2Z"/><path d="M9 12.2l2 2 4-4.2"/>`,
  link: `<path d="M9.5 14.5 14.5 9.5"/><path d="M11.2 7.2l1.3-1.3a3.4 3.4 0 0 1 4.8 4.8l-1.3 1.3"/><path d="M12.8 16.8l-1.3 1.3a3.4 3.4 0 0 1-4.8-4.8l1.3-1.3"/>`,
  users: `<circle cx="8.3" cy="8.3" r="3"/><circle cx="16.8" cy="9.6" r="2.4"/><path d="M2.5 19.7c0-3.8 2.7-5.9 5.8-5.9s5.8 2.1 5.8 5.9"/><path d="M14.8 14.4c2.6.4 4.2 2.3 4.7 5.3"/>`,
  phone: `<path d="M5 4.2h3.3l1.3 4-1.7 1.1a11.4 11.4 0 0 0 6.8 6.8l1.1-1.7 4 1.3V19a1.8 1.8 0 0 1-1.9 1.8A15.4 15.4 0 0 1 3.2 6.1 1.8 1.8 0 0 1 5 4.2Z"/>`,
  mail: `<rect x="3" y="5.5" width="18" height="13" rx="1"/><path d="M3.4 6.2 12 12.8l8.6-6.6"/>`,
  "map-pin": `<path d="M12 21s6.5-6 6.5-10.6a6.5 6.5 0 0 0-13 0C5.5 15 12 21 12 21Z"/><circle cx="12" cy="10.2" r="2.1"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.8l3 2.4"/>`,
  headset: `<path d="M4.5 13.2v-.9a7.5 7.5 0 0 1 15 0v.9"/><rect x="3" y="13.2" width="4" height="6" rx="1"/><rect x="17" y="13.2" width="4" height="6" rx="1"/>`,
  "badge-percent": `<circle cx="12" cy="12" r="8.5"/><path d="M8.2 15.8 15.8 8.2"/><circle cx="9.3" cy="9.3" r="1.1"/><circle cx="14.7" cy="14.7" r="1.1"/>`,
  coins: `<ellipse cx="8.5" cy="7.5" rx="5.5" ry="2.7"/><path d="M3 7.5v5c0 1.5 2.5 2.7 5.5 2.7s5.5-1.2 5.5-2.7v-5"/><path d="M3 12.5v3.2c0 1.5 2.5 2.7 5.5 2.7s5.5-1.2 5.5-2.7v-3.2"/>`,
  handshake: `<path d="M2.5 12 6 8.6a2 2 0 0 1 2.7-.1l1.5 1.3"/><path d="M21.5 12 18 8.6a2 2 0 0 0-2.7-.1l-3.9 3.4a1.4 1.4 0 0 0 1.8 2.1l2.4-1.8"/><path d="M9.8 13.3l1.7 1.5a1.4 1.4 0 0 0 1.9-2l-.2-.2"/><path d="M2.5 12l3.3 4.6 2-1.4M21.5 12l-3.1 4.8-2.1-1.3"/>`,
  chart: `<path d="M4 20V4M4 20h16"/><rect x="7" y="13" width="2.6" height="7"/><rect x="11.7" y="9" width="2.6" height="11"/><rect x="16.4" y="6" width="2.6" height="14"/>`,
};

function sfmIcon(name, size = 26) {
  const inner = SFM_ICONS[name] || SFM_ICONS.coins;
  return `<svg class="sfm-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
