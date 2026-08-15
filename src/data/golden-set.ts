import type { GoldenVenue } from '../lib/golden-types'

/**
 * Golden set — hand-verified ground truth for the extraction pipeline.
 *
 * Ten venues across the three scenario cities, 54 named spaces. Every figure
 * here was read off the venue's OWN capacity page at the URL recorded with it.
 * This file is frozen ground truth: it is never regenerated from the seed
 * corpus at runtime, because a test that derives its expectations from the
 * thing under test measures nothing.
 *
 * `npm run eval:golden` re-fetches each URL, runs the live extraction adapter
 * over it, and scores the result. That is the number that tells you whether the
 * `verified` label means anything — a trust system whose extraction precision
 * is unmeasured is a trust system making claims it has not earned.
 *
 * Verified against source pages on 2026-08-14.
 */
export const GOLDEN_SET: GoldenVenue[] = [
  {
    "venue": "Carmine's Italian Restaurant - Times Square",
    "city": "nyc",
    "url": "https://carminesnyc.com/parties/times-square",
    "spaces": [
      {
        "name": "The Sinatra Room",
        "seated": 230,
        "standing": 275
      },
      {
        "name": "The Jimmy Durante Room",
        "seated": 200,
        "standing": 175
      },
      {
        "name": "Full Restaurant Buyout",
        "seated": 450,
        "standing": 700
      },
      {
        "name": "The Tetrazzini Space (semi-private)",
        "seated": 58,
        "standing": 50
      }
    ]
  },
  {
    "venue": "Blue Fin (W New York - Times Square)",
    "city": "nyc",
    "url": "https://www.bluefinnyc.com/private-events/",
    "spaces": [
      {
        "name": "West Room",
        "seated": 65,
        "standing": 120
      },
      {
        "name": "West & Collector's Room (combined)",
        "seated": 79,
        "standing": 130
      },
      {
        "name": "Upstairs (entire second floor)",
        "seated": 250,
        "standing": 300
      },
      {
        "name": "East Room",
        "seated": 38,
        "standing": 40
      }
    ]
  },
  {
    "venue": "The Westin New York at Times Square",
    "city": "nyc",
    "url": "https://www.marriott.com/en-us/hotels/nycsw-the-westin-new-york-at-times-square/events/",
    "spaces": [
      {
        "name": "Broadway I",
        "seated": 70,
        "standing": 50
      },
      {
        "name": "Gramercy",
        "seated": 50,
        "standing": 40
      },
      {
        "name": "Majestic Ballroom",
        "seated": 320,
        "standing": 300
      },
      {
        "name": "Broadway Ballroom",
        "seated": 280,
        "standing": 275
      }
    ]
  },
  {
    "venue": "Perbacco Ristorante + Bar",
    "city": "sf",
    "url": "https://www.perbaccosf.com/dining/",
    "spaces": [
      {
        "name": "Barbaresco Room",
        "seated": 40,
        "standing": 70
      },
      {
        "name": "Barolo Room",
        "seated": 18,
        "standing": 25
      },
      {
        "name": "Chef's Table",
        "seated": 8,
        "standing": null
      },
      {
        "name": "Mezzanine",
        "seated": 75,
        "standing": 120
      },
      {
        "name": "Restaurant Buyout",
        "seated": 150,
        "standing": 250
      }
    ]
  },
  {
    "venue": "The Cavalier",
    "city": "sf",
    "url": "https://www.thecavaliersf.com/private-events/",
    "spaces": [
      {
        "name": "Blue Bar",
        "seated": 35,
        "standing": 45
      },
      {
        "name": "Wine Stables",
        "seated": 26,
        "standing": 30
      },
      {
        "name": "Marianne's",
        "seated": 22,
        "standing": 50
      },
      {
        "name": "Full Buyout",
        "seated": 140,
        "standing": 300
      },
      {
        "name": "S&R Lounge at Hotel Zetta",
        "seated": null,
        "standing": 100
      }
    ]
  },
  {
    "venue": "Wayfare Tavern",
    "city": "sf",
    "url": "https://www.wayfaretavern.com/private-events",
    "spaces": [
      {
        "name": "Juniper Dining Room",
        "seated": 30,
        "standing": 45
      },
      {
        "name": "Barbary Room",
        "seated": 50,
        "standing": 65
      },
      {
        "name": "Sequoia Lounge",
        "seated": 35,
        "standing": 65
      },
      {
        "name": "Juniper Bar",
        "seated": 10,
        "standing": 20
      },
      {
        "name": "Cellar Dining Room",
        "seated": 30,
        "standing": null
      }
    ]
  },
  {
    "venue": "Harborview Restaurant & Bar",
    "city": "sf",
    "url": "https://www.harborviewsf.com/private-events/",
    "spaces": [
      {
        "name": "Shanghai Room",
        "seated": 30,
        "standing": 20
      },
      {
        "name": "Hong Kong Room",
        "seated": 24,
        "standing": null
      },
      {
        "name": "Asia Room",
        "seated": 50,
        "standing": null
      },
      {
        "name": "Main Dining Room",
        "seated": 180,
        "standing": 200
      },
      {
        "name": "Patio",
        "seated": 180,
        "standing": 250
      }
    ]
  },
  {
    "venue": "Hilton Hawaiian Village Waikiki Beach Resort",
    "city": "honolulu",
    "url": "https://hiltonhawaiianvillage.com/gather/capacity-charts/",
    "spaces": [
      {
        "name": "Coral Ballroom",
        "seated": 2400,
        "standing": 3775
      },
      {
        "name": "Coral I",
        "seated": 200,
        "standing": 416
      },
      {
        "name": "Coral I/II (combined)",
        "seated": 400,
        "standing": 832
      },
      {
        "name": "Coral III",
        "seated": 700,
        "standing": 1135
      },
      {
        "name": "Coral IV/V (combined)",
        "seated": 900,
        "standing": 1508
      },
      {
        "name": "Tapa Ballroom",
        "seated": 1500,
        "standing": 1900
      },
      {
        "name": "Tapa I",
        "seated": 400,
        "standing": 609
      },
      {
        "name": "Tapa II",
        "seated": 500,
        "standing": 682
      },
      {
        "name": "Tapa III",
        "seated": 320,
        "standing": 506
      },
      {
        "name": "South Pacific Ballroom",
        "seated": 520,
        "standing": 702
      },
      {
        "name": "Honolulu Suite",
        "seated": 300,
        "standing": 439
      },
      {
        "name": "Rainbow Suite",
        "seated": 180,
        "standing": 273
      },
      {
        "name": "The Great Lawn (outdoor)",
        "seated": 1100,
        "standing": 1600
      },
      {
        "name": "Village Green (outdoor)",
        "seated": 200,
        "standing": 250
      }
    ]
  },
  {
    "venue": "Halekulani",
    "city": "honolulu",
    "url": "https://www.halekulani.com/space-category/meetings-events/",
    "spaces": [
      {
        "name": "Halekulani Ballroom",
        "seated": 300,
        "standing": 500
      },
      {
        "name": "Hau Terrace & Lanai (outdoor)",
        "seated": 120,
        "standing": 300
      },
      {
        "name": "Garden Courtyard (outdoor)",
        "seated": null,
        "standing": 600
      },
      {
        "name": "Lewers Lounge Banquet Room",
        "seated": null,
        "standing": 50
      }
    ]
  },
  {
    "venue": "OUTRIGGER Reef Waikiki Beach Resort",
    "city": "honolulu",
    "url": "https://www.outrigger.com/hawaii/oahu/outrigger-reef-waikiki-beach-resort/meetings",
    "spaces": [
      {
        "name": "A'e Kai Courtyard (outdoor)",
        "seated": 400,
        "standing": 500
      },
      {
        "name": "Diamond Head Ballroom (full)",
        "seated": 160,
        "standing": 180
      },
      {
        "name": "Diamond Head Ballroom - 3 sections",
        "seated": 120,
        "standing": 135
      },
      {
        "name": "Makani Terrace (outdoor)",
        "seated": 60,
        "standing": 75
      }
    ]
  }
]
