const shapes = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  crops: (
    <>
      <path d="M12 21V11" />
      <path d="M12 11C12 7 9 4 5 4c0 4 3 7 7 7Z" />
      <path d="M12 14c0-3 2.5-5.5 5.5-5.5C17.5 11.5 15 14 12 14Z" />
    </>
  ),
  prices: (
    <>
      <path d="M3 17l5-5 3 3 7-8" />
      <path d="M14 7h6v6" />
    </>
  ),
  markets: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6h10v10H3z" />
      <path d="M13 9h4l3 3v4h-7z" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  tracking: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  bookings: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="m9 15 2 2 4-4" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  chat: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.4A8 8 0 0 1 3 12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
      <path d="M8 11h8M8 15h5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10.5 21h3" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4C10 4 4 8 4 15c0 3 2 5 5 5 7 0 11-6 11-16Z" />
      <path d="M4 20c4-6 8-8 12-10" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  check: <path d="m4 12 5 5L20 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  rupee: (
    <>
      <path d="M6 4h12M6 8h12M15 4c0 5-4 5-7 5l8 9" />
    </>
  ),
  package: (
    <>
      <path d="m12 3 9 4.5v9L12 21l-9-4.5v-9z" />
      <path d="m3.5 7.5 8.5 4.3 8.5-4.3M12 21v-9" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 14h10l1-14M10 11v6M14 11v6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.7-4L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.7 4L21 15" />
      <path d="M21 20v-5h-5" />
    </>
  ),
  send: <path d="m3 11 18-8-8 18-2.5-7.5z" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H14a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  phone: (
    <path d="M6 3h3l2 5-2.5 1.5a14 14 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-2.4 3.3M6.2 6.3A16 16 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  arrowUp: <path d="M12 19V5m-6 6 6-6 6 6" />,
  arrowDown: <path d="M12 5v14m6-6-6 6-6-6" />,
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  sparkles: (
    <>
      <path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M19 15.5 20 18l2.5 1L20 20l-1 2.5L18 20l-2.5-1L18 18z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18M6 21h12" />
      <path d="M4 7h16M7 7 4 14h6zM17 7l-3 7h6z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
}

export default function Icon({ name, size = 18, strokeWidth = 1.7, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {shapes[name] || shapes.info}
    </svg>
  )
}
