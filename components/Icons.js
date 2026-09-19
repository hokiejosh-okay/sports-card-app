// components/Icons.js — inline SVG icons (no icon library). Stroke uses currentColor.
window.CV = window.CV || {};

(function () {
  function make(paths, opts) {
    opts = opts || {};
    return function Icon(props) {
      props = props || {};
      const size = props.size || 22;
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={opts.fill ? "currentColor" : "none"}
          stroke={opts.fill ? "none" : "currentColor"}
          strokeWidth={props.strokeWidth || 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={props.className || ""}
          aria-hidden="true"
        >
          {paths}
        </svg>
      );
    };
  }

  CV.Icons = {
    Collection: make([
      <rect key="a" x="3" y="3" width="7" height="7" rx="1.5" />,
      <rect key="b" x="14" y="3" width="7" height="7" rx="1.5" />,
      <rect key="c" x="3" y="14" width="7" height="7" rx="1.5" />,
      <rect key="d" x="14" y="14" width="7" height="7" rx="1.5" />,
    ]),
    Plus: make([<path key="a" d="M12 5v14M5 12h14" />]),
    Insights: make([
      <path key="a" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    ]),
    Search: make([<circle key="a" cx="11" cy="11" r="7" />, <path key="b" d="M21 21l-4.3-4.3" />]),
    Back: make([<path key="a" d="M15 18l-6-6 6-6" />]),
    Pencil: make([
      <path key="a" d="M12 20h9" />,
      <path key="b" d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />,
    ]),
    Trash: make([
      <path key="a" d="M3 6h18" />,
      <path key="b" d="M8 6V4h8v2" />,
      <path key="c" d="M6 6l1 14h10l1-14" />,
    ]),
    More: make([
      <circle key="a" cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />,
      <circle key="b" cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />,
      <circle key="c" cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />,
    ]),
    Camera: make([
      <path key="a" d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />,
      <circle key="b" cx="12" cy="13" r="3.2" />,
    ]),
    Close: make([<path key="a" d="M6 6l12 12M18 6L6 18" />]),
    Check: make([<path key="a" d="M20 6L9 17l-5-5" />]),
    Sun: make([
      <circle key="a" cx="12" cy="12" r="4" />,
      <path key="b" d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />,
    ]),
    Moon: make([<path key="a" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />]),
    Swap: make([
      <path key="a" d="M7 4L3 8l4 4" />,
      <path key="b" d="M3 8h14" />,
      <path key="c" d="M17 20l4-4-4-4" />,
      <path key="d" d="M21 16H7" />,
    ]),
    External: make([
      <path key="a" d="M14 4h6v6" />,
      <path key="b" d="M20 4l-8.5 8.5" />,
      <path key="c" d="M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5" />,
    ]),
  };
})();
