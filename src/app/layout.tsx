import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Meliva spetsialistiprofiilid", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="et">
      <body>
        <a className="skip" href="#main">Liigu sisu juurde</a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
