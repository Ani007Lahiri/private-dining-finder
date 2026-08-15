export interface GoldenSpace {
  name: string
  seated: number | null
  standing: number | null
}

export interface GoldenVenue {
  venue: string
  city: string
  url: string
  spaces: GoldenSpace[]
}
