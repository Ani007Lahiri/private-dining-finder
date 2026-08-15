import type { Metadata } from 'next'
import 'leaflet/dist/leaflet.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Private Dining Finder',
  description:
    'Ranked private dining and event venue search for corporate event planners, with per-field provenance and trust labelling.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
