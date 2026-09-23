"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Archivio" },
  { href: "/guests", label: "Ospiti" },
  { href: "/config", label: "Configurazione" },
];

export function Nav() {
  const pathname = usePathname();
  // Una conversazione aperta ha già la sua barra di stato e i suoi comandi:
  // lì la navigazione si fa discreta invece di contendersi l'attenzione.
  const inConversation = /^\/episodes\/[^/]+$/.test(pathname);

  return (
    <header
      className="border-line bg-page/95 sticky top-0 z-30 border-b backdrop-blur-md"
    >
      {/* L'attenuazione sta sul contenuto, non sull'intestazione: messa sul
          contenitore rendeva semitrasparente anche lo sfondo, e scorrendo la
          trascrizione ci passava attraverso. */}
      <nav
        className={`mx-auto flex max-w-6xl items-center gap-1 px-6 py-2.5 transition-opacity ${
          inConversation ? "opacity-60 hover:opacity-100" : ""
        }`}
      >
        <Link
          href="/"
          className="mr-5 flex items-center gap-2.5"
          aria-label="Convivio, vai all'archivio"
        >
          <Mark />
          <span className="text-ink text-[0.9375rem] font-medium tracking-tight">
            Convivio
          </span>
        </Link>

        {LINKS.map((link) => {
          // "/" combacia con tutto: la home è attiva solo se esatta.
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "text-ink bg-raised"
                  : "text-ink-dim hover:text-ink hover:bg-panel"
              }`}
            >
              {link.label}
            </Link>
          );
        })}

        <Link
          href="/episodes/new"
          // L'etichetta è lunga: senza il blocco andrebbe a capo e sfonderebbe
          // la barra sulle finestre strette.
          className="bg-ink text-page hover:bg-white/95 ml-auto shrink-0 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-transform active:scale-[0.97]"
        >
          Nuova conversazione
        </Link>
      </nav>
    </header>
  );
}

/** Tre barre di livello: il programma sono tre voci che si alternano. */
function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="6" width="3" height="6" rx="1.5" fill="#c96442" />
      <rect x="7.5" y="2.5" width="3" height="13" rx="1.5" fill="#10a37f" />
      <rect x="14" y="6" width="3" height="6" rx="1.5" fill="#4285f4" />
    </svg>
  );
}
