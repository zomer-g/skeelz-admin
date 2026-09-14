/**
 * Whether each integration has its configuration in place. "Configured" means
 * the env vars exist — not that a connection was verified; the sync status
 * screens (M3+) report actual connectivity.
 */
export interface IntegrationStatus {
  key: "salesforce" | "ga4" | "gtm" | "smoov";
  name: string;
  scope: string;
  envVars: string[];
  guide: string;
  milestone: string;
  configured: boolean;
}

const DEFINITIONS: Omit<IntegrationStatus, "configured">[] = [
  {
    key: "salesforce",
    name: "Salesforce",
    scope: "Case · Contact · Account — קריאה בלבד",
    envVars: ["SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"],
    guide: "docs/setup-salesforce-eca.md",
    milestone: "M2–M3",
  },
  {
    key: "ga4",
    name: "Google Analytics 4",
    scope: "G-Q9E4S9RLLC — צפיות ואירועים לפי משרה",
    envVars: ["GA4_PROPERTY_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"],
    guide: "docs/setup-google.md",
    milestone: "M5",
  },
  {
    key: "gtm",
    name: "Google Tag Manager",
    scope: "GTM-KJJCSQ44 — תגים וטריגרים (קריאה)",
    envVars: ["GTM_ACCOUNT_ID", "GTM_CONTAINER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"],
    guide: "docs/gtm-job-id.md",
    milestone: "M5",
  },
  {
    key: "smoov",
    name: "SMOOV",
    scope: "רשימות, קמפיינים וסטטיסטיקות",
    envVars: ["SMOOV_API_KEY"],
    guide: "docs/setup-smoov.md",
    milestone: "M6",
  },
];

// Locally the Google key may come from a file instead of the JSON variable.
const isSet = (key: string) =>
  Boolean(process.env[key]) || (key === "GOOGLE_SERVICE_ACCOUNT_JSON" && Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_FILE));

export function integrationStatus(): IntegrationStatus[] {
  return DEFINITIONS.map((d) => ({ ...d, configured: d.envVars.every(isSet) }));
}
