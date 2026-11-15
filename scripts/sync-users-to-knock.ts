// One-off backfill: syncs every existing user to Knock, writing the default
// Notification preferences for anyone who has none yet. Safe to re-run.
//
//   npm run knock:sync-users
import { db } from "../app/db";
import { serverEnv } from "../app/lib/env.server";
import { getNotifications } from "../app/lib/notifications.server";
import { syncAllUsers } from "../app/lib/users.server";

if (!serverEnv("KNOCK_SECRET_API_KEY")) {
  console.error(
    "KNOCK_SECRET_API_KEY is missing. Run bash scripts/knock-setup-wizard.sh first."
  );
  process.exit(1);
}

const count = await syncAllUsers(db, getNotifications());
console.log(`Synced ${count} users to Knock.`);
