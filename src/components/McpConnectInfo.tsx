import { headers } from "next/headers";
import { publicOrigin, resourceUrl } from "@/lib/mcp/config";

function Code({ children }: { children: string }) {
  return (
    <code dir="ltr" className="block overflow-x-auto rounded-xl bg-white px-4 py-3 text-start font-mono text-sm ring-1 ring-line">
      {children}
    </code>
  );
}

/** The server address and how to connect to it, on /connectors, /api-docs and /admin/api. */
export async function McpConnectInfo() {
  const url = resourceUrl(publicOrigin(await headers()));
  return (
    <ol className="flex list-decimal flex-col gap-4 ps-5">
      <li>
        <p className="mb-2">כתובת שרת ה-MCP (אין צורך במפתח: ההתחברות היא עם חשבון Google):</p>
        <Code>{url}</Code>
      </li>
      <li>
        <p className="mb-2">
          <strong>Claude</strong> (claude.ai או האפליקציה): הגדרות ← Connectors ← Add custom connector, שם לבחירה (למשל SKEELZ) והכתובת שלמעלה.
        </p>
      </li>
      <li>
        <p className="mb-2">
          <strong>Claude Code</strong>: מריצים בטרמינל, ואז <span dir="ltr">/mcp</span> ← skeelz ← Authenticate:
        </p>
        <Code>{`claude mcp add --transport http skeelz ${url}`}</Code>
      </li>
      <li>
        <strong>ChatGPT, Cursor ואחרים</strong>: כל לקוח שתומך ב-MCP מרוחק (Streamable HTTP) עם OAuth. מוסיפים שרת חדש עם הכתובת שלמעלה.
      </li>
      <li>
        נפתח חלון התחברות עם חשבון Google, כמו בכניסה למערכת, ואחריו מסך אישור שבו בוחרים באיזו הרשאה החיבור יעבוד — לכל היותר ההרשאה שלך במערכת.
        רק מי שמורשה להיכנס למערכת יכול להתחבר.
      </li>
    </ol>
  );
}
