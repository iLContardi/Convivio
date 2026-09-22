import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Il serif serve solo al parlato: è la riga che separa ciò che gli
 * ospiti dicono da ciò che il programma mostra. Si carica anche in
 * corsivo perché nei turni ricorre davvero.
 */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Convivio",
  description: "Conversazioni fra più intelligenze artificiali, moderate da te",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="bg-page text-ink flex min-h-full flex-col">
        <Nav />
        {children}
      </body>
    </html>
  );
}
