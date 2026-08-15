import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Private Dining Finder',
  description:
    'Ranked private dining and event venue search for corporate event planners, with per-field provenance and trust labelling.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
