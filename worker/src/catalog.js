/** Poll catalog for the live scoreboard Fan Polls API.
 *  Adding a new poll (e.g. championships-2027) is: append an object to POLLS
 *  with id, title, options, and optional baselineVotes, then redeploy.
 *  Baselines below were copied from the existing Grok-hosted polls on
 *  2026-11-27T14:29:00Z (15:29 Europe/Berlin) and must not be invented.
 */
export const CATALOG_META = {
  "capturedAt": "2026-11-27T14:29:00Z",
  "source": {
    "ncaa": "https://rocket-forge-comet-vivid.grok.me/_serverFn/f25614a9b56e9955931d77171ec050b195c06c7caa18cf659d6bddbc1b47e00e",
    "aa": "https://forge-fleet-tundra-zinc.grok.me/_serverFn/c8ccbeb2b2b96162dd88cb3870092de50675887557c5797af31e8048e11ea80b",
    "note": "Baselines are the exact live tallies returned by the existing Grok polls on 2026-11-27 (15:29 Europe/Berlin). Teams/athletes with no key in the API counts object had 0 votes."
  }
};

export const POLLS = [
  {
    "id": "ncaa-champions-2027",
    "title": "NCAA Champions Poll",
    "subtitle": "2027 preseason — who takes the national title?",
    "season": 2027,
    "kind": "team",
    "status": "active",
    "sortOrder": 1,
    "note": "One vote per poll — your pick is final.",
    "searchable": true,
    "resultsPreview": 15,
    "options": [
      {
        "id": "alabama",
        "label": "Alabama",
        "sublabel": "Crimson Tide · SEC",
        "sortOrder": 0,
        "baselineVotes": 0,
        "meta": {
          "abbr": "ALA",
          "shortName": "Alabama",
          "mascot": "Crimson Tide",
          "conference": "SEC",
          "city": "Tuscaloosa",
          "state": "AL",
          "color": "#9E1B32",
          "contender": true
        }
      },
      {
        "id": "arkansas",
        "label": "Arkansas",
        "sublabel": "Razorbacks · SEC",
        "sortOrder": 1,
        "baselineVotes": 1,
        "meta": {
          "abbr": "ARK",
          "shortName": "Arkansas",
          "mascot": "Razorbacks",
          "conference": "SEC",
          "city": "Fayetteville",
          "state": "AR",
          "color": "#9D2235",
          "contender": true
        }
      },
      {
        "id": "auburn",
        "label": "Auburn",
        "sublabel": "Tigers · SEC",
        "sortOrder": 2,
        "baselineVotes": 0,
        "meta": {
          "abbr": "AUB",
          "shortName": "Auburn",
          "mascot": "Tigers",
          "conference": "SEC",
          "city": "Auburn",
          "state": "AL",
          "color": "#0C2340",
          "contender": false
        }
      },
      {
        "id": "florida",
        "label": "Florida",
        "sublabel": "Gators · SEC",
        "sortOrder": 3,
        "baselineVotes": 2,
        "meta": {
          "abbr": "FLA",
          "shortName": "Florida",
          "mascot": "Gators",
          "conference": "SEC",
          "city": "Gainesville",
          "state": "FL",
          "color": "#0021A5",
          "contender": true
        }
      },
      {
        "id": "georgia",
        "label": "Georgia",
        "sublabel": "GymDogs · SEC",
        "sortOrder": 4,
        "baselineVotes": 5,
        "meta": {
          "abbr": "UGA",
          "shortName": "Georgia",
          "mascot": "GymDogs",
          "conference": "SEC",
          "city": "Athens",
          "state": "GA",
          "color": "#BA0C2F",
          "contender": true
        }
      },
      {
        "id": "kentucky",
        "label": "Kentucky",
        "sublabel": "Wildcats · SEC",
        "sortOrder": 5,
        "baselineVotes": 2,
        "meta": {
          "abbr": "UK",
          "shortName": "Kentucky",
          "mascot": "Wildcats",
          "conference": "SEC",
          "city": "Lexington",
          "state": "KY",
          "color": "#0033A0",
          "contender": false
        }
      },
      {
        "id": "lsu",
        "label": "LSU",
        "sublabel": "Tigers · SEC",
        "sortOrder": 6,
        "baselineVotes": 15,
        "meta": {
          "abbr": "LSU",
          "shortName": "LSU",
          "mascot": "Tigers",
          "conference": "SEC",
          "city": "Baton Rouge",
          "state": "LA",
          "color": "#461D7C",
          "contender": true
        }
      },
      {
        "id": "missouri",
        "label": "Missouri",
        "sublabel": "Tigers · SEC",
        "sortOrder": 7,
        "baselineVotes": 2,
        "meta": {
          "abbr": "MIZ",
          "shortName": "Missouri",
          "mascot": "Tigers",
          "conference": "SEC",
          "city": "Columbia",
          "state": "MO",
          "color": "#F1B82D",
          "contender": false
        }
      },
      {
        "id": "oklahoma",
        "label": "Oklahoma",
        "sublabel": "Sooners · SEC",
        "sortOrder": 8,
        "baselineVotes": 29,
        "meta": {
          "abbr": "OU",
          "shortName": "Oklahoma",
          "mascot": "Sooners",
          "conference": "SEC",
          "city": "Norman",
          "state": "OK",
          "color": "#841617",
          "contender": true
        }
      },
      {
        "id": "illinois",
        "label": "Illinois",
        "sublabel": "Fighting Illini · Big Ten",
        "sortOrder": 9,
        "baselineVotes": 0,
        "meta": {
          "abbr": "ILL",
          "shortName": "Illinois",
          "mascot": "Fighting Illini",
          "conference": "Big Ten",
          "city": "Champaign",
          "state": "IL",
          "color": "#E84A27",
          "contender": false
        }
      },
      {
        "id": "iowa",
        "label": "Iowa",
        "sublabel": "Hawkeyes · Big Ten",
        "sortOrder": 10,
        "baselineVotes": 1,
        "meta": {
          "abbr": "IOWA",
          "shortName": "Iowa",
          "mascot": "Hawkeyes",
          "conference": "Big Ten",
          "city": "Iowa City",
          "state": "IA",
          "color": "#000000",
          "contender": false
        }
      },
      {
        "id": "maryland",
        "label": "Maryland",
        "sublabel": "Terrapins · Big Ten",
        "sortOrder": 11,
        "baselineVotes": 1,
        "meta": {
          "abbr": "MD",
          "shortName": "Maryland",
          "mascot": "Terrapins",
          "conference": "Big Ten",
          "city": "College Park",
          "state": "MD",
          "color": "#E03A3E",
          "contender": false
        }
      },
      {
        "id": "michigan",
        "label": "Michigan",
        "sublabel": "Wolverines · Big Ten",
        "sortOrder": 12,
        "baselineVotes": 1,
        "meta": {
          "abbr": "MICH",
          "shortName": "Michigan",
          "mascot": "Wolverines",
          "conference": "Big Ten",
          "city": "Ann Arbor",
          "state": "MI",
          "color": "#00274C",
          "contender": true
        }
      },
      {
        "id": "michigan-state",
        "label": "Michigan State",
        "sublabel": "Spartans · Big Ten",
        "sortOrder": 13,
        "baselineVotes": 0,
        "meta": {
          "abbr": "MSU",
          "shortName": "Michigan St.",
          "mascot": "Spartans",
          "conference": "Big Ten",
          "city": "East Lansing",
          "state": "MI",
          "color": "#18453B",
          "contender": true
        }
      },
      {
        "id": "minnesota",
        "label": "Minnesota",
        "sublabel": "Golden Gophers · Big Ten",
        "sortOrder": 14,
        "baselineVotes": 16,
        "meta": {
          "abbr": "MINN",
          "shortName": "Minnesota",
          "mascot": "Golden Gophers",
          "conference": "Big Ten",
          "city": "Minneapolis",
          "state": "MN",
          "color": "#7A0019",
          "contender": true
        }
      },
      {
        "id": "nebraska",
        "label": "Nebraska",
        "sublabel": "Huskers · Big Ten",
        "sortOrder": 15,
        "baselineVotes": 1,
        "meta": {
          "abbr": "NEB",
          "shortName": "Nebraska",
          "mascot": "Huskers",
          "conference": "Big Ten",
          "city": "Lincoln",
          "state": "NE",
          "color": "#E41C38",
          "contender": false
        }
      },
      {
        "id": "ohio-state",
        "label": "Ohio State",
        "sublabel": "Buckeyes · Big Ten",
        "sortOrder": 16,
        "baselineVotes": 0,
        "meta": {
          "abbr": "OSU",
          "shortName": "Ohio State",
          "mascot": "Buckeyes",
          "conference": "Big Ten",
          "city": "Columbus",
          "state": "OH",
          "color": "#BB0000",
          "contender": false
        }
      },
      {
        "id": "penn-state",
        "label": "Penn State",
        "sublabel": "Nittany Lions · Big Ten",
        "sortOrder": 17,
        "baselineVotes": 0,
        "meta": {
          "abbr": "PSU",
          "shortName": "Penn State",
          "mascot": "Nittany Lions",
          "conference": "Big Ten",
          "city": "University Park",
          "state": "PA",
          "color": "#041E42",
          "contender": false
        }
      },
      {
        "id": "rutgers",
        "label": "Rutgers",
        "sublabel": "Scarlet Knights · Big Ten",
        "sortOrder": 18,
        "baselineVotes": 0,
        "meta": {
          "abbr": "RUT",
          "shortName": "Rutgers",
          "mascot": "Scarlet Knights",
          "conference": "Big Ten",
          "city": "New Brunswick",
          "state": "NJ",
          "color": "#CC0033",
          "contender": false
        }
      },
      {
        "id": "ucla",
        "label": "UCLA",
        "sublabel": "Bruins · Big Ten",
        "sortOrder": 19,
        "baselineVotes": 2,
        "meta": {
          "abbr": "UCLA",
          "shortName": "UCLA",
          "mascot": "Bruins",
          "conference": "Big Ten",
          "city": "Los Angeles",
          "state": "CA",
          "color": "#2D68C4",
          "contender": true
        }
      },
      {
        "id": "washington",
        "label": "Washington",
        "sublabel": "Huskies · Big Ten",
        "sortOrder": 20,
        "baselineVotes": 0,
        "meta": {
          "abbr": "UW",
          "shortName": "Washington",
          "mascot": "Huskies",
          "conference": "Big Ten",
          "city": "Seattle",
          "state": "WA",
          "color": "#4B2E83",
          "contender": false
        }
      },
      {
        "id": "california",
        "label": "California",
        "sublabel": "Golden Bears · ACC",
        "sortOrder": 21,
        "baselineVotes": 0,
        "meta": {
          "abbr": "CAL",
          "shortName": "Cal",
          "mascot": "Golden Bears",
          "conference": "ACC",
          "city": "Berkeley",
          "state": "CA",
          "color": "#003262",
          "contender": false
        }
      },
      {
        "id": "clemson",
        "label": "Clemson",
        "sublabel": "Tigers · ACC",
        "sortOrder": 22,
        "baselineVotes": 5,
        "meta": {
          "abbr": "CLEM",
          "shortName": "Clemson",
          "mascot": "Tigers",
          "conference": "ACC",
          "city": "Clemson",
          "state": "SC",
          "color": "#F56600",
          "contender": false
        }
      },
      {
        "id": "north-carolina",
        "label": "North Carolina",
        "sublabel": "Tar Heels · ACC",
        "sortOrder": 23,
        "baselineVotes": 0,
        "meta": {
          "abbr": "UNC",
          "shortName": "North Carolina",
          "mascot": "Tar Heels",
          "conference": "ACC",
          "city": "Chapel Hill",
          "state": "NC",
          "color": "#7BAFD4",
          "contender": false
        }
      },
      {
        "id": "nc-state",
        "label": "NC State",
        "sublabel": "Wolfpack · ACC",
        "sortOrder": 24,
        "baselineVotes": 0,
        "meta": {
          "abbr": "NCSU",
          "shortName": "NC State",
          "mascot": "Wolfpack",
          "conference": "ACC",
          "city": "Raleigh",
          "state": "NC",
          "color": "#CC0000",
          "contender": false
        }
      },
      {
        "id": "pitt",
        "label": "Pittsburgh",
        "sublabel": "Panthers · ACC",
        "sortOrder": 25,
        "baselineVotes": 0,
        "meta": {
          "abbr": "PITT",
          "shortName": "Pitt",
          "mascot": "Panthers",
          "conference": "ACC",
          "city": "Pittsburgh",
          "state": "PA",
          "color": "#003594",
          "contender": false
        }
      },
      {
        "id": "stanford",
        "label": "Stanford",
        "sublabel": "Cardinal · ACC",
        "sortOrder": 26,
        "baselineVotes": 0,
        "meta": {
          "abbr": "STAN",
          "shortName": "Stanford",
          "mascot": "Cardinal",
          "conference": "ACC",
          "city": "Stanford",
          "state": "CA",
          "color": "#8C1515",
          "contender": true
        }
      },
      {
        "id": "arizona",
        "label": "Arizona",
        "sublabel": "Wildcats · Big 12",
        "sortOrder": 27,
        "baselineVotes": 0,
        "meta": {
          "abbr": "ARIZ",
          "shortName": "Arizona",
          "mascot": "Wildcats",
          "conference": "Big 12",
          "city": "Tucson",
          "state": "AZ",
          "color": "#CC0033",
          "contender": false
        }
      },
      {
        "id": "arizona-state",
        "label": "Arizona State",
        "sublabel": "Sun Devils · Big 12",
        "sortOrder": 28,
        "baselineVotes": 0,
        "meta": {
          "abbr": "ASU",
          "shortName": "Arizona St.",
          "mascot": "Sun Devils",
          "conference": "Big 12",
          "city": "Tempe",
          "state": "AZ",
          "color": "#8C1D40",
          "contender": false
        }
      },
      {
        "id": "byu",
        "label": "BYU",
        "sublabel": "Cougars · Big 12",
        "sortOrder": 29,
        "baselineVotes": 1,
        "meta": {
          "abbr": "BYU",
          "shortName": "BYU",
          "mascot": "Cougars",
          "conference": "Big 12",
          "city": "Provo",
          "state": "UT",
          "color": "#002E5D",
          "contender": false
        }
      },
      {
        "id": "denver",
        "label": "Denver",
        "sublabel": "Pioneers · Big 12",
        "sortOrder": 30,
        "baselineVotes": 0,
        "meta": {
          "abbr": "DEN",
          "shortName": "Denver",
          "mascot": "Pioneers",
          "conference": "Big 12",
          "city": "Denver",
          "state": "CO",
          "color": "#8B2332",
          "contender": false
        }
      },
      {
        "id": "iowa-state",
        "label": "Iowa State",
        "sublabel": "Cyclones · Big 12",
        "sortOrder": 31,
        "baselineVotes": 0,
        "meta": {
          "abbr": "ISU",
          "shortName": "Iowa State",
          "mascot": "Cyclones",
          "conference": "Big 12",
          "city": "Ames",
          "state": "IA",
          "color": "#C8102E",
          "contender": false
        }
      },
      {
        "id": "utah",
        "label": "Utah",
        "sublabel": "Utes · Big 12",
        "sortOrder": 32,
        "baselineVotes": 1,
        "meta": {
          "abbr": "UTAH",
          "shortName": "Utah",
          "mascot": "Utes",
          "conference": "Big 12",
          "city": "Salt Lake City",
          "state": "UT",
          "color": "#CC0000",
          "contender": true
        }
      },
      {
        "id": "west-virginia",
        "label": "West Virginia",
        "sublabel": "Mountaineers · Big 12",
        "sortOrder": 33,
        "baselineVotes": 0,
        "meta": {
          "abbr": "WVU",
          "shortName": "West Virginia",
          "mascot": "Mountaineers",
          "conference": "Big 12",
          "city": "Morgantown",
          "state": "WV",
          "color": "#002855",
          "contender": false
        }
      },
      {
        "id": "ball-state",
        "label": "Ball State",
        "sublabel": "Cardinals · MAC",
        "sortOrder": 34,
        "baselineVotes": 0,
        "meta": {
          "abbr": "BALL",
          "shortName": "Ball State",
          "mascot": "Cardinals",
          "conference": "MAC",
          "city": "Muncie",
          "state": "IN",
          "color": "#BA0C2F",
          "contender": false
        }
      },
      {
        "id": "bowling-green",
        "label": "Bowling Green",
        "sublabel": "Falcons · MAC",
        "sortOrder": 35,
        "baselineVotes": 0,
        "meta": {
          "abbr": "BGSU",
          "shortName": "Bowling Green",
          "mascot": "Falcons",
          "conference": "MAC",
          "city": "Bowling Green",
          "state": "OH",
          "color": "#4F2C1D",
          "contender": false
        }
      },
      {
        "id": "central-michigan",
        "label": "Central Michigan",
        "sublabel": "Chippewas · MAC",
        "sortOrder": 36,
        "baselineVotes": 0,
        "meta": {
          "abbr": "CMU",
          "shortName": "Central Mich.",
          "mascot": "Chippewas",
          "conference": "MAC",
          "city": "Mount Pleasant",
          "state": "MI",
          "color": "#6A0032",
          "contender": false
        }
      },
      {
        "id": "eastern-michigan",
        "label": "Eastern Michigan",
        "sublabel": "Eagles · MAC",
        "sortOrder": 37,
        "baselineVotes": 0,
        "meta": {
          "abbr": "EMU",
          "shortName": "Eastern Mich.",
          "mascot": "Eagles",
          "conference": "MAC",
          "city": "Ypsilanti",
          "state": "MI",
          "color": "#006633",
          "contender": false
        }
      },
      {
        "id": "kent-state",
        "label": "Kent State",
        "sublabel": "Golden Flashes · MAC",
        "sortOrder": 38,
        "baselineVotes": 1,
        "meta": {
          "abbr": "KENT",
          "shortName": "Kent State",
          "mascot": "Golden Flashes",
          "conference": "MAC",
          "city": "Kent",
          "state": "OH",
          "color": "#002664",
          "contender": false
        }
      },
      {
        "id": "northern-illinois",
        "label": "Northern Illinois",
        "sublabel": "Huskies · MAC",
        "sortOrder": 39,
        "baselineVotes": 0,
        "meta": {
          "abbr": "NIU",
          "shortName": "Northern Ill.",
          "mascot": "Huskies",
          "conference": "MAC",
          "city": "DeKalb",
          "state": "IL",
          "color": "#BA0C2F",
          "contender": false
        }
      },
      {
        "id": "western-michigan",
        "label": "Western Michigan",
        "sublabel": "Broncos · MAC",
        "sortOrder": 40,
        "baselineVotes": 0,
        "meta": {
          "abbr": "WMU",
          "shortName": "Western Mich.",
          "mascot": "Broncos",
          "conference": "MAC",
          "city": "Kalamazoo",
          "state": "MI",
          "color": "#6C4023",
          "contender": false
        }
      },
      {
        "id": "george-washington",
        "label": "George Washington",
        "sublabel": "Revolutionaries · EAGL",
        "sortOrder": 41,
        "baselineVotes": 0,
        "meta": {
          "abbr": "GW",
          "shortName": "GW",
          "mascot": "Revolutionaries",
          "conference": "EAGL",
          "city": "Washington",
          "state": "DC",
          "color": "#033C5A",
          "contender": false
        }
      },
      {
        "id": "liu",
        "label": "LIU",
        "sublabel": "Sharks · EAGL",
        "sortOrder": 42,
        "baselineVotes": 1,
        "meta": {
          "abbr": "LIU",
          "shortName": "LIU",
          "mascot": "Sharks",
          "conference": "EAGL",
          "city": "Brookville",
          "state": "NY",
          "color": "#69B3E7",
          "contender": false
        }
      },
      {
        "id": "new-hampshire",
        "label": "New Hampshire",
        "sublabel": "Wildcats · EAGL",
        "sortOrder": 43,
        "baselineVotes": 1,
        "meta": {
          "abbr": "UNH",
          "shortName": "New Hampshire",
          "mascot": "Wildcats",
          "conference": "EAGL",
          "city": "Durham",
          "state": "NH",
          "color": "#003087",
          "contender": false
        }
      },
      {
        "id": "temple",
        "label": "Temple",
        "sublabel": "Owls · EAGL",
        "sortOrder": 44,
        "baselineVotes": 0,
        "meta": {
          "abbr": "TEM",
          "shortName": "Temple",
          "mascot": "Owls",
          "conference": "EAGL",
          "city": "Philadelphia",
          "state": "PA",
          "color": "#9D2235",
          "contender": false
        }
      },
      {
        "id": "towson",
        "label": "Towson",
        "sublabel": "Tigers · EAGL",
        "sortOrder": 45,
        "baselineVotes": 0,
        "meta": {
          "abbr": "TOW",
          "shortName": "Towson",
          "mascot": "Tigers",
          "conference": "EAGL",
          "city": "Towson",
          "state": "MD",
          "color": "#000000",
          "contender": false
        }
      },
      {
        "id": "air-force",
        "label": "Air Force",
        "sublabel": "Falcons · MW",
        "sortOrder": 46,
        "baselineVotes": 0,
        "meta": {
          "abbr": "AFA",
          "shortName": "Air Force",
          "mascot": "Falcons",
          "conference": "MW",
          "city": "Colorado Springs",
          "state": "CO",
          "color": "#003087",
          "contender": false
        }
      },
      {
        "id": "boise-state",
        "label": "Boise State",
        "sublabel": "Broncos · Pac-12",
        "sortOrder": 47,
        "baselineVotes": 0,
        "meta": {
          "abbr": "BSU",
          "shortName": "Boise State",
          "mascot": "Broncos",
          "conference": "Pac-12",
          "city": "Boise",
          "state": "ID",
          "color": "#0033A0",
          "contender": false
        }
      },
      {
        "id": "san-jose-state",
        "label": "San Jose State",
        "sublabel": "Spartans · MW",
        "sortOrder": 48,
        "baselineVotes": 0,
        "meta": {
          "abbr": "SJSU",
          "shortName": "San Jose St.",
          "mascot": "Spartans",
          "conference": "MW",
          "city": "San Jose",
          "state": "CA",
          "color": "#0055A2",
          "contender": false
        }
      },
      {
        "id": "utah-state",
        "label": "Utah State",
        "sublabel": "Aggies · Pac-12",
        "sortOrder": 49,
        "baselineVotes": 0,
        "meta": {
          "abbr": "USU",
          "shortName": "Utah State",
          "mascot": "Aggies",
          "conference": "Pac-12",
          "city": "Logan",
          "state": "UT",
          "color": "#0F2439",
          "contender": false
        }
      },
      {
        "id": "sacramento-state",
        "label": "Sacramento State",
        "sublabel": "Hornets · MPSF",
        "sortOrder": 50,
        "baselineVotes": 0,
        "meta": {
          "abbr": "SAC",
          "shortName": "Sacramento St.",
          "mascot": "Hornets",
          "conference": "MPSF",
          "city": "Sacramento",
          "state": "CA",
          "color": "#043927",
          "contender": false
        }
      },
      {
        "id": "southern-utah",
        "label": "Southern Utah",
        "sublabel": "Thunderbirds · Pac-12",
        "sortOrder": 51,
        "baselineVotes": 0,
        "meta": {
          "abbr": "SUU",
          "shortName": "Southern Utah",
          "mascot": "Thunderbirds",
          "conference": "Pac-12",
          "city": "Cedar City",
          "state": "UT",
          "color": "#C41230",
          "contender": false
        }
      },
      {
        "id": "uc-davis",
        "label": "UC Davis",
        "sublabel": "Aggies · MPSF",
        "sortOrder": 52,
        "baselineVotes": 0,
        "meta": {
          "abbr": "UCD",
          "shortName": "UC Davis",
          "mascot": "Aggies",
          "conference": "MPSF",
          "city": "Davis",
          "state": "CA",
          "color": "#022851",
          "contender": false
        }
      },
      {
        "id": "brown",
        "label": "Brown",
        "sublabel": "Bears · GEC",
        "sortOrder": 53,
        "baselineVotes": 1,
        "meta": {
          "abbr": "BRWN",
          "shortName": "Brown",
          "mascot": "Bears",
          "conference": "GEC",
          "city": "Providence",
          "state": "RI",
          "color": "#4E3629",
          "contender": false
        }
      },
      {
        "id": "cornell",
        "label": "Cornell",
        "sublabel": "Big Red · GEC",
        "sortOrder": 54,
        "baselineVotes": 0,
        "meta": {
          "abbr": "COR",
          "shortName": "Cornell",
          "mascot": "Big Red",
          "conference": "GEC",
          "city": "Ithaca",
          "state": "NY",
          "color": "#B31B1B",
          "contender": false
        }
      },
      {
        "id": "penn",
        "label": "Penn",
        "sublabel": "Quakers · GEC",
        "sortOrder": 55,
        "baselineVotes": 0,
        "meta": {
          "abbr": "PENN",
          "shortName": "Penn",
          "mascot": "Quakers",
          "conference": "GEC",
          "city": "Philadelphia",
          "state": "PA",
          "color": "#011F5B",
          "contender": false
        }
      },
      {
        "id": "william-mary",
        "label": "William & Mary",
        "sublabel": "Tribe · GEC",
        "sortOrder": 56,
        "baselineVotes": 0,
        "meta": {
          "abbr": "W&M",
          "shortName": "William & Mary",
          "mascot": "Tribe",
          "conference": "GEC",
          "city": "Williamsburg",
          "state": "VA",
          "color": "#115740",
          "contender": false
        }
      },
      {
        "id": "yale",
        "label": "Yale",
        "sublabel": "Bulldogs · GEC",
        "sortOrder": 57,
        "baselineVotes": 0,
        "meta": {
          "abbr": "YALE",
          "shortName": "Yale",
          "mascot": "Bulldogs",
          "conference": "GEC",
          "city": "New Haven",
          "state": "CT",
          "color": "#00356B",
          "contender": false
        }
      },
      {
        "id": "illinois-state",
        "label": "Illinois State",
        "sublabel": "Redbirds · MIC",
        "sortOrder": 58,
        "baselineVotes": 1,
        "meta": {
          "abbr": "ILST",
          "shortName": "Illinois St.",
          "mascot": "Redbirds",
          "conference": "MIC",
          "city": "Normal",
          "state": "IL",
          "color": "#CE1126",
          "contender": false
        }
      },
      {
        "id": "lindenwood",
        "label": "Lindenwood",
        "sublabel": "Lions · MIC",
        "sortOrder": 59,
        "baselineVotes": 0,
        "meta": {
          "abbr": "LWU",
          "shortName": "Lindenwood",
          "mascot": "Lions",
          "conference": "MIC",
          "city": "St. Charles",
          "state": "MO",
          "color": "#000000",
          "contender": false
        }
      },
      {
        "id": "semo",
        "label": "SEMO",
        "sublabel": "Redhawks · MIC",
        "sortOrder": 60,
        "baselineVotes": 0,
        "meta": {
          "abbr": "SEMO",
          "shortName": "SEMO",
          "mascot": "Redhawks",
          "conference": "MIC",
          "city": "Cape Girardeau",
          "state": "MO",
          "color": "#C41230",
          "contender": false
        }
      },
      {
        "id": "quinnipiac",
        "label": "Quinnipiac",
        "sublabel": "Bobcats · MAAC",
        "sortOrder": 61,
        "baselineVotes": 0,
        "meta": {
          "abbr": "QU",
          "shortName": "Quinnipiac",
          "mascot": "Bobcats",
          "conference": "MAAC",
          "city": "Hamden",
          "state": "CT",
          "color": "#0B2341",
          "contender": false
        }
      },
      {
        "id": "oregon-state",
        "label": "Oregon State",
        "sublabel": "Beavers · Pac-12",
        "sortOrder": 62,
        "baselineVotes": 1,
        "meta": {
          "abbr": "ORST",
          "shortName": "Oregon State",
          "mascot": "Beavers",
          "conference": "Pac-12",
          "city": "Corvallis",
          "state": "OR",
          "color": "#DC4405",
          "contender": false
        }
      }
    ]
  },
  {
    "id": "aa-champion-2027",
    "title": "AA Champion Poll",
    "subtitle": "2027 all-around — one vote, national tally.",
    "season": 2027,
    "kind": "athlete",
    "status": "active",
    "sortOrder": 2,
    "note": "One vote per poll — your pick is final.",
    "searchable": true,
    "resultsPreview": 15,
    "options": [
      {
        "id": "chio",
        "label": "Kailin Chio",
        "sublabel": "LSU",
        "sortOrder": 0,
        "baselineVotes": 22,
        "meta": {
          "school": "LSU"
        }
      },
      {
        "id": "fatta",
        "label": "Addison Fatta",
        "sublabel": "Oklahoma",
        "sortOrder": 1,
        "baselineVotes": 39,
        "meta": {
          "school": "Oklahoma"
        }
      },
      {
        "id": "neff",
        "label": "Avery Neff",
        "sublabel": "Utah",
        "sortOrder": 2,
        "baselineVotes": 7,
        "meta": {
          "school": "Utah"
        }
      },
      {
        "id": "dicello",
        "label": "Kayla DiCello",
        "sublabel": "Florida",
        "sortOrder": 3,
        "baselineVotes": 1,
        "meta": {
          "school": "Florida"
        }
      },
      {
        "id": "pederson",
        "label": "Lily Pederson",
        "sublabel": "Oklahoma",
        "sortOrder": 4,
        "baselineVotes": 7,
        "meta": {
          "school": "Oklahoma"
        }
      },
      {
        "id": "ostrum",
        "label": "Arianna Ostrum",
        "sublabel": "Minnesota",
        "sortOrder": 5,
        "baselineVotes": 33,
        "meta": {
          "school": "Minnesota"
        }
      },
      {
        "id": "estep",
        "label": "Mackenzie Estep",
        "sublabel": "Oklahoma",
        "sortOrder": 6,
        "baselineVotes": 16,
        "meta": {
          "school": "Oklahoma"
        }
      }
    ]
  }
];
