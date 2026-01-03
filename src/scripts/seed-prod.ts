import "dotenv/config";
import { sql, closeConnection } from "../db/client.js";
import { createUser } from "../db/queries/users.js";
import { createCouple, addCoupleMembers } from "../db/queries/couples.js";
import { createThread, addParticipant } from "../db/queries/threads.js";

export async function seedProduction(): Promise<void> {
  console.log("Checking production data...\n");

  // Check if production data already exists
  const existingUsers = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM users WHERE email IN ('yoderblake@gmail.com', 'amandaleslieyoder@gmail.com')
  `;

  if (existingUsers[0].count > 0) {
    console.log("Production data already exists. Skipping seed.");
    return;
  }

  // Create Blake and Amanda
  console.log("Creating users...");
  const blake = await createUser("yoderblake@gmail.com", "Blake");
  console.log(`  Created: ${blake.name} (${blake.email})`);

  const amanda = await createUser("amandaleslieyoder@gmail.com", "Amanda");
  console.log(`  Created: ${amanda.name} (${amanda.email})`);

  // Create couple
  console.log("\nCreating couple...");
  const couple = await createCouple("Blake & Amanda");
  await addCoupleMembers(couple.id, blake.id, amanda.id);
  console.log(`  Created: ${couple.name}`);

  // Create shared thread
  console.log("\nCreating threads...");
  const sharedThread = await createThread(couple.id, "shared", blake.id);
  await addParticipant(sharedThread.id, blake.id);
  await addParticipant(sharedThread.id, amanda.id);
  console.log(`  Created: shared thread (${sharedThread.id})`);

  // Create DM threads for each user
  const blakeDm = await createThread(couple.id, "dm", blake.id, blake.id);
  await addParticipant(blakeDm.id, blake.id);
  console.log(`  Created: Blake's DM thread (${blakeDm.id})`);

  const amandaDm = await createThread(couple.id, "dm", amanda.id, amanda.id);
  await addParticipant(amandaDm.id, amanda.id);
  console.log(`  Created: Amanda's DM thread (${amandaDm.id})`);

  console.log("\nProduction data seeded successfully!");
  console.log("\nUser IDs:");
  console.log(`  Blake: ${blake.id}`);
  console.log(`  Amanda: ${amanda.id}`);
  console.log(`\nCouple ID: ${couple.id}`);
  console.log(`\nThread IDs:`);
  console.log(`  Shared: ${sharedThread.id}`);
  console.log(`  Blake DM: ${blakeDm.id}`);
  console.log(`  Amanda DM: ${amandaDm.id}`);
}

// Run as standalone script
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seedProduction()
    .then(() => closeConnection())
    .catch((error) => {
      console.error("Seed failed:", error);
      process.exit(1);
    });
}
