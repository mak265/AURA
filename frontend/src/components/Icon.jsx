const paths = {
  pin: <><path d="m9 3 8 0-1 6 3 4H5l3-4 1-6ZM12 13v8"/></>,
  archive: <><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v14h14V7M9 11h6"/></>,
  mute: <><path d="M6 6v12h4l5 4V2l-5 4H6Zm12 3 4 6m0-6-4 6"/></>,
  warning: <><path d="m12 3 10 18H2L12 3ZM12 9v5M12 17v.5"/></>,
  block: <><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,

  mic: <><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
  photo: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>,
  chevron: <path d="m8 10 4 4 4-4"/>,
  spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>,

  discover: <><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></>,
  feed: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  talk: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a8.5 8.5 0 0 1 17 0Z"/><path d="M8 11h8M8 15h5"/></>,
  heart: <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>,
  profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  filters: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
  edit: <><path d="m15 4 5 5M4 20l1-6L16 3l5 5-11 11-6 1Z"/></>,
};
export default function Icon({ name, size = 20, className = '' }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>{paths[name] || paths.talk}</svg>;
}
