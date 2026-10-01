import type { Role } from "@/lib/auth/roles";

/** What each role lets an MCP connection do, for the consent and connect screens. */
export const MCP_ROLE_SCOPE: Record<Role, string> = {
  viewer: "קריאה: דשבורדים ורשומות — משרות, הגשות, מועמדים, חברות, תשלומים וקמפיינים",
  editor: "כמו צפייה, ובנוסף עריכת פרטי קמפיינים וקישור משרות לקמפיין",
  admin: "כמו עורך, ובנוסף רשימת המשתמשים, יומן הפעילות ומצב הסנכרון",
};
